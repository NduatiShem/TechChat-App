import type { OutboxPayload } from '@/types/database';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { messagesAPI } from './api';
import {
  getDb,
  getMessageByClientMessageId,
  replaceMessageAttachments,
  updateMessageStatus,
} from './database';
import {
  getPendingOutboxEntries,
  resetOutboxForRetry,
  updateOutboxStatus,
  upsertOutboxEntry,
} from './outboxDatabase';
import { logger } from '@/utils/logger';
import { captureException } from './sentry';

const shouldLogOutbox =
  __DEV__ ||
  process.env.EXPO_PUBLIC_DEBUG_CHAT === 'true' ||
  process.env.EXPO_PUBLIC_DEBUG_API === 'true';

const MAX_ATTEMPTS = 12;
const MIN_RETRY_MS = 2000;
const WORKER_INTERVAL_MS = 15000;

const sendingClientIds = new Set<string>();

/**
 * In-memory fallback queue for messages whose local SQLite outbox write failed
 * (e.g. corrupted/locked DB). Keeps the message alive as "pending" so the user
 * is never told to "check your connection" while offline. The worker re-attempts
 * the durable DB write, and direct-sends when online.
 */
type MemoryQueueEntry = {
  clientMessageId: string;
  localMessageId: number | null;
  conversationId: number;
  conversationType: 'individual' | 'group';
  payload: OutboxPayload;
};
const memoryQueue = new Map<string, MemoryQueueEntry>();

let workerInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;
let appState: AppStateStatus = 'active';
let appStateSub: { remove: () => void } | null = null;
let netSub: (() => void) | null = null;

export type OutboxSyncAttachment = {
  id: number;
  name: string;
  mime: string;
  url: string;
};

export type OutboxSyncEvent = {
  clientMessageId: string;
  localMessageId: number;
  serverId?: number;
  serverCreatedAt?: string;
  status: 'synced' | 'failed' | 'pending';
  attachments?: OutboxSyncAttachment[];
};

type OutboxListener = (event: OutboxSyncEvent) => void;
const listeners = new Set<OutboxListener>();

export function subscribeOutboxSync(listener: OutboxListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: OutboxSyncEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch (e) {
      logger.error('[Outbox] Listener error:', e);
    }
  });
}

function extractServerMessageId(data: unknown): { id?: number; created_at?: string } {
  if (!data || typeof data !== 'object') return {};
  const d = data as Record<string, unknown>;
  if (typeof d.id === 'number') {
    return { id: d.id, created_at: d.created_at as string | undefined };
  }
  if (d.data && typeof d.data === 'object') {
    const inner = d.data as Record<string, unknown>;
    if (typeof inner.id === 'number') {
      return { id: inner.id, created_at: inner.created_at as string | undefined };
    }
  }
  if (d.message && typeof d.message === 'object') {
    const msg = d.message as Record<string, unknown>;
    if (typeof msg.id === 'number') {
      return { id: msg.id, created_at: msg.created_at as string | undefined };
    }
  }
  if (typeof d.message_id === 'number') {
    return {
      id: d.message_id,
      created_at: (d.created_at || d.message_created_at) as string | undefined,
    };
  }
  return {};
}

function getMessagePayloadFromResponse(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const root = data as Record<string, unknown>;

  if (Array.isArray(root.attachments)) {
    return root;
  }

  const nestedMessage = root.message;
  if (nestedMessage && typeof nestedMessage === 'object') {
    return nestedMessage as Record<string, unknown>;
  }

  const nestedData = root.data;
  if (nestedData && typeof nestedData === 'object') {
    const inner = nestedData as Record<string, unknown>;
    if (Array.isArray(inner.attachments)) {
      return inner;
    }
    if (inner.message && typeof inner.message === 'object') {
      return inner.message as Record<string, unknown>;
    }
  }

  return null;
}

function extractServerAttachments(data: unknown): OutboxSyncAttachment[] {
  const message = getMessagePayloadFromResponse(data);
  if (!message || !Array.isArray(message.attachments)) {
    return [];
  }

  return message.attachments
    .map((raw, index) => {
      if (!raw || typeof raw !== 'object') return null;
      const att = raw as Record<string, unknown>;
      const url = String(att.url ?? att.path ?? '');
      const name = String(att.name ?? att.file_name ?? `attachment_${index + 1}`);
      const mime = String(att.mime ?? att.mime_type ?? att.type ?? 'application/octet-stream');
      const id = Number(att.id ?? att.server_id ?? index + 1);
      if (!url) return null;
      return { id, name, mime, url };
    })
    .filter((att): att is OutboxSyncAttachment => att !== null);
}

async function finalizeSuccessfulSend(params: {
  clientMessageId: string;
  localMessageId: number | null;
  responseData: unknown;
}): Promise<void> {
  const { clientMessageId, localMessageId, responseData } = params;
  const { id: serverId, created_at: serverCreatedAt } = extractServerMessageId(responseData);
  const attachments = extractServerAttachments(responseData);

  if (localMessageId && serverId) {
    await updateMessageStatus(localMessageId, serverId, 'synced', serverCreatedAt);
  }
  if (localMessageId && attachments.length > 0) {
    await replaceMessageAttachments(
      localMessageId,
      attachments.map((att) => ({
        server_id: att.id,
        name: att.name,
        mime: att.mime,
        url: att.url,
      }))
    );
  }

  emit({
    clientMessageId,
    localMessageId: localMessageId ?? 0,
    serverId,
    serverCreatedAt,
    status: 'synced',
    attachments: attachments.length > 0 ? attachments : undefined,
  });
}

function buildFormData(payload: OutboxPayload, clientMessageId: string): FormData {
  const formData = new FormData();
  formData.append('client_message_id', clientMessageId);

  if (payload.receiver_id != null) {
    formData.append('receiver_id', String(payload.receiver_id));
  }
  if (payload.group_id != null) {
    formData.append('group_id', String(payload.group_id));
  }
  if (payload.reply_to_id != null) {
    formData.append('reply_to_id', String(payload.reply_to_id));
  }
  if (payload.message) {
    formData.append('message', payload.message);
  }
  if (payload.is_voice_message && payload.voice_duration != null) {
    formData.append('voice_duration', String(payload.voice_duration));
    formData.append('is_voice_message', 'true');
  }
  if (payload.attachments?.length) {
    for (const att of payload.attachments) {
      formData.append('attachments[]', {
        uri: att.uri,
        name: att.name,
        type: att.mime,
      } as unknown as Blob);
    }
  }
  return formData;
}

function backoffMs(attempts: number): number {
  return Math.min(MIN_RETRY_MS * Math.pow(2, attempts), 120000);
}

export async function enqueueOutgoingMessage(params: {
  clientMessageId: string;
  localMessageId: number | null;
  conversationId: number;
  conversationType: 'individual' | 'group';
  payload: OutboxPayload;
}): Promise<void> {
  try {
    await upsertOutboxEntry({
      clientMessageId: params.clientMessageId,
      localMessageId: params.localMessageId,
      conversationId: params.conversationId,
      conversationType: params.conversationType,
      payload: params.payload,
    });
    memoryQueue.delete(params.clientMessageId);
    if (shouldLogOutbox) {
      logger.debug('[Outbox] Enqueued', params.clientMessageId, params.localMessageId);
    }
    kickOutboxWorker();
  } catch (error) {
    // Durable write failed. Never lose the message and never hard-fail the send:
    // keep it in memory as pending and let the worker retry the DB write / send.
    logger.warn('[Outbox] Local enqueue failed, holding in memory queue:', error);
    memoryQueue.set(params.clientMessageId, {
      clientMessageId: params.clientMessageId,
      localMessageId: params.localMessageId,
      conversationId: params.conversationId,
      conversationType: params.conversationType,
      payload: params.payload,
    });

    const net = await NetInfo.fetch();
    if (net.isConnected) {
      // Online: try to push immediately; if it fails it stays queued in memory.
      try {
        await sendPayloadDirectly(params);
        memoryQueue.delete(params.clientMessageId);
        return;
      } catch (sendError) {
        logger.warn('[Outbox] Direct send failed, will retry:', sendError);
      }
    }

    // Offline (or direct send failed): surface as pending, schedule retries.
    emit({
      clientMessageId: params.clientMessageId,
      localMessageId: params.localMessageId ?? 0,
      status: 'pending',
    });
    kickOutboxWorker();
  }
}

/** Re-attempt durable persistence (and online direct-send) for memory-queued messages. */
async function flushMemoryQueue(): Promise<void> {
  if (memoryQueue.size === 0) return;

  const entries = Array.from(memoryQueue.values());
  for (const entry of entries) {
    try {
      await upsertOutboxEntry({
        clientMessageId: entry.clientMessageId,
        localMessageId: entry.localMessageId,
        conversationId: entry.conversationId,
        conversationType: entry.conversationType,
        payload: entry.payload,
      });
      memoryQueue.delete(entry.clientMessageId);
      if (shouldLogOutbox) {
        logger.debug('[Outbox] Memory entry persisted to DB', entry.clientMessageId);
      }
    } catch {
      // Still can't persist. If online, try a direct send so the message is delivered.
      const net = await NetInfo.fetch();
      if (net.isConnected) {
        try {
          await sendPayloadDirectly(entry);
          memoryQueue.delete(entry.clientMessageId);
        } catch {
          // keep for next cycle
        }
      }
    }
  }
}

async function sendPayloadDirectly(params: {
  clientMessageId: string;
  localMessageId: number | null;
  payload: OutboxPayload;
}): Promise<void> {
  const { clientMessageId, localMessageId, payload } = params;
  const net = await NetInfo.fetch();
  if (!net.isConnected) {
    throw new Error('Offline and local storage unavailable. Please try again when online.');
  }

  const formData = buildFormData(payload, clientMessageId);

  try {
    const res = await messagesAPI.sendMessage(formData);

    if (res.status >= 200 && res.status < 300) {
      await finalizeSuccessfulSend({
        clientMessageId,
        localMessageId,
        responseData: res.data,
      });
      if (shouldLogOutbox) {
        logger.debug('[Outbox] Direct send synced', clientMessageId);
      }
    }
  } catch (error: unknown) {
    const err = error as { response?: { status?: number; data?: unknown }; message?: string };
    if (err.response?.status === 409) {
      const serverId = extractServerMessageId(err.response.data).id;
      if (serverId) {
        await finalizeSuccessfulSend({
          clientMessageId,
          localMessageId,
          responseData: err.response.data,
        });
        return;
      }
    }
    throw error;
  }
}

export async function requeueOutboxMessage(clientMessageId: string): Promise<void> {
  await resetOutboxForRetry(clientMessageId);
  kickOutboxWorker();
}

async function processSingleOutboxEntry(
  row: Awaited<ReturnType<typeof getPendingOutboxEntries>>[number]
): Promise<void> {
  let { client_message_id: clientMessageId, local_message_id: localMessageId, attempts } = row;

  if (!clientMessageId || sendingClientIds.has(clientMessageId)) return;

  if (localMessageId == null || localMessageId === 0) {
    const localRow = await getMessageByClientMessageId(clientMessageId);
    if (localRow) {
      localMessageId = localRow.id;
    }
  }

  if (localMessageId == null || localMessageId === 0) {
    // Payload-only outbox entry; send still proceeds, status updates skipped until linked
  }

  if (row.last_attempt_at) {
    const elapsed = Date.now() - new Date(row.last_attempt_at).getTime();
    if (elapsed < backoffMs(attempts)) return;
  }

  if (attempts >= MAX_ATTEMPTS) {
    await updateOutboxStatus(clientMessageId, 'failed');
    if (localMessageId) {
      await updateMessageStatus(localMessageId, undefined, 'failed');
    }
    emit({ clientMessageId, localMessageId: localMessageId ?? 0, status: 'failed' });
    return;
  }

  const database = await getDb();
  if (database && localMessageId) {
    const existing = await database.getFirstAsync<{ server_id?: number }>(
      `SELECT server_id FROM messages WHERE id = ?`,
      [localMessageId]
    );
    if (existing?.server_id) {
      await updateOutboxStatus(clientMessageId, 'synced');
      await updateMessageStatus(localMessageId, existing.server_id, 'synced');
      emit({
        clientMessageId,
        localMessageId,
        serverId: existing.server_id,
        status: 'synced',
      });
      return;
    }
  }

  sendingClientIds.add(clientMessageId);
  await updateOutboxStatus(clientMessageId, 'sending', attempts + 1, new Date().toISOString());

  let payload: OutboxPayload;
  try {
    payload = JSON.parse(row.payload_json) as OutboxPayload;
  } catch {
    await updateOutboxStatus(clientMessageId, 'failed');
    if (localMessageId) {
      await updateMessageStatus(localMessageId, undefined, 'failed');
    }
    emit({ clientMessageId, localMessageId: localMessageId ?? 0, status: 'failed' });
    sendingClientIds.delete(clientMessageId);
    return;
  }

  try {
    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      await updateOutboxStatus(clientMessageId, 'pending', attempts + 1, new Date().toISOString());
      sendingClientIds.delete(clientMessageId);
      return;
    }

    const formData = buildFormData(payload, clientMessageId);
    const res = await messagesAPI.sendMessage(formData);

    if (res.status >= 200 && res.status < 300) {
      const serverId = extractServerMessageId(res.data).id;
      if (serverId) {
        await finalizeSuccessfulSend({
          clientMessageId,
          localMessageId,
          responseData: res.data,
        });
        await updateOutboxStatus(clientMessageId, 'synced');
        if (shouldLogOutbox) {
          logger.debug('[Outbox] Synced', clientMessageId, '→', serverId);
        }
      } else {
        await updateOutboxStatus(clientMessageId, 'pending', attempts + 1, new Date().toISOString());
        emit({ clientMessageId, localMessageId: localMessageId ?? 0, status: 'pending' });
        captureException(new Error('[Outbox] 2xx response missing server message id'), {
          clientMessageId,
          localMessageId: localMessageId ?? 0,
        });
      }
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (error: unknown) {
    const err = error as { response?: { status?: number; data?: unknown }; message?: string };
    const status = err.response?.status;
    const isClientError = status != null && status >= 400 && status < 500;

    if (status === 409) {
      const serverId = extractServerMessageId(err.response?.data).id;
      if (serverId) {
        await finalizeSuccessfulSend({
          clientMessageId,
          localMessageId,
          responseData: err.response?.data,
        });
        await updateOutboxStatus(clientMessageId, 'synced');
      } else {
        await updateOutboxStatus(clientMessageId, 'pending', attempts + 1, new Date().toISOString());
        emit({ clientMessageId, localMessageId: localMessageId ?? 0, status: 'pending' });
      }
    } else if (isClientError) {
      await updateOutboxStatus(clientMessageId, 'failed');
      if (localMessageId) {
        await updateMessageStatus(localMessageId, undefined, 'failed');
      }
      emit({ clientMessageId, localMessageId: localMessageId ?? 0, status: 'failed' });
      logger.error('[Outbox] Permanent failure', clientMessageId, status);
    } else {
      await updateOutboxStatus(clientMessageId, 'pending', attempts + 1, new Date().toISOString());
      emit({ clientMessageId, localMessageId: localMessageId ?? 0, status: 'pending' });
    }
  } finally {
    sendingClientIds.delete(clientMessageId);
  }
}

export async function processOutboxQueue(): Promise<void> {
  if (isProcessing || appState !== 'active') return;
  isProcessing = true;
  try {
    await flushMemoryQueue();
    const entries = await getPendingOutboxEntries(15);
    for (const entry of entries) {
      await processSingleOutboxEntry(entry);
    }
  } catch (e) {
    logger.error('[Outbox] processOutboxQueue error:', e);
  } finally {
    isProcessing = false;
  }
}

export function kickOutboxWorker(): void {
  if (appState !== 'active') return;
  processOutboxQueue().catch((e) => logger.error('[Outbox] kick error:', e));
}

export function startOutboxWorker(intervalMs = WORKER_INTERVAL_MS): void {
  stopOutboxWorker();

  appStateSub = AppState.addEventListener('change', (next) => {
    appState = next;
    if (next === 'active') kickOutboxWorker();
  });

  netSub = NetInfo.addEventListener((state) => {
    if (state.isConnected) kickOutboxWorker();
  });

  setTimeout(() => {
    workerInterval = setInterval(() => {
      if (appState === 'active') {
        processOutboxQueue().catch((e) => logger.error('[Outbox] interval error:', e));
      }
    }, intervalMs);
    kickOutboxWorker();
  }, 1500);

  if (shouldLogOutbox) {
    logger.debug('[Outbox] Worker started, interval', intervalMs);
  }
}

export function stopOutboxWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  appStateSub?.remove();
  appStateSub = null;
  netSub?.();
  netSub = null;
}

/** @deprecated use startOutboxWorker — kept for messageRetryService shim */
export function markMessageAsSending(localMessageId: number): void {
  // Outbox uses client_message_id; legacy float IDs still excluded via sendingClientIds by local id lookup
  sendingClientIds.add(`local:${localMessageId}`);
}

export function unmarkMessageAsSending(localMessageId: number): void {
  sendingClientIds.delete(`local:${localMessageId}`);
}

export function isMessageBeingSent(localMessageId: number): boolean {
  return sendingClientIds.has(`local:${localMessageId}`);
}

export function getMessagesBeingSent(): Set<number> {
  const ids = new Set<number>();
  for (const key of sendingClientIds) {
    if (key.startsWith('local:')) {
      ids.add(Number(key.slice(6)));
    }
  }
  return ids;
}
