import Pusher from 'pusher-js';
import type { ChatMessage } from '@/types/chat';
import { apiMessageToChatMessage } from '@/types/chat';
import { persistApiMessages } from '@/services/chatMessageService';
import { dedupeMessages } from '@/utils/messageDedup';
import { getApiBaseUrl } from '@/services/api';
import { secureStorage } from '@/utils/secureStore';

type MessageHandler = (message: ChatMessage) => void;
type ReadHandler = (payload: { conversationId: number; readAt: string }) => void;

let pusher: Pusher | null = null;
let pusherInitPromise: Promise<Pusher | null> | null = null;
let connected = false;

const messageHandlers = new Set<MessageHandler>();
const readHandlers = new Set<ReadHandler>();
const activeChannels = new Map<string, { channel: ReturnType<Pusher['subscribe']>; refCount: number }>();

async function createPusherClient(): Promise<Pusher | null> {
  const key = process.env.EXPO_PUBLIC_PUSHER_KEY;
  const cluster = process.env.EXPO_PUBLIC_PUSHER_CLUSTER || 'mt1';
  const wsHost = process.env.EXPO_PUBLIC_REVERB_HOST;
  const wsPort = process.env.EXPO_PUBLIC_REVERB_PORT;

  if (!key && !wsHost) return null;

  const token = await secureStorage.getItem('auth_token');
  const authEndpoint = `${getApiBaseUrl()}/broadcasting/auth`;

  return new Pusher(key || 'local', {
    cluster,
    wsHost,
    wsPort: wsPort ? Number(wsPort) : undefined,
    forceTLS: process.env.EXPO_PUBLIC_REVERB_SCHEME !== 'http',
    enabledTransports: ['ws', 'wss'],
    authEndpoint,
    auth: {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  });
}

async function getPusher(): Promise<Pusher | null> {
  if (pusher) return pusher;
  if (!pusherInitPromise) {
    pusherInitPromise = createPusherClient().then((client) => {
      if (!client) return null;
      pusher = client;
      pusher.connection.bind('connected', () => {
        connected = true;
      });
      pusher.connection.bind('disconnected', () => {
        connected = false;
      });
      return pusher;
    });
  }
  return pusherInitPromise;
}

export function isRealtimeConnected(): boolean {
  return connected;
}

export function initRealtimeService(): void {
  void getPusher();
}

function bindChannelEvents(channel: ReturnType<Pusher['subscribe']>): void {
  channel.bind('MessageSent', (data: Record<string, unknown>) => {
    const message = apiMessageToChatMessage(data);
    messageHandlers.forEach((fn) => fn(message));
  });
  channel.bind('MessagesRead', (data: { conversation_id?: number; read_at?: string }) => {
    if (data.conversation_id && data.read_at) {
      readHandlers.forEach((fn) =>
        fn({ conversationId: data.conversation_id!, readAt: data.read_at! })
      );
    }
  });
}

export function subscribeConversationChannel(params: {
  conversationId: number;
  conversationType: 'individual' | 'group';
}): () => void {
  const channelName = `private-conversation.${params.conversationType}.${params.conversationId}`;
  let disposed = false;

  void (async () => {
    const client = await getPusher();
    if (!client) return;

    let entry = activeChannels.get(channelName);
    if (!entry) {
      const channel = client.subscribe(channelName);
      bindChannelEvents(channel);
      entry = { channel, refCount: 0 };
      activeChannels.set(channelName, entry);
    }

    if (disposed) {
      entry.refCount -= 1;
      if (entry.refCount <= 0) {
        client.unsubscribe(channelName);
        activeChannels.delete(channelName);
      }
      return;
    }

    entry.refCount += 1;
  })();

  return () => {
    disposed = true;
    const client = pusher;
    const current = activeChannels.get(channelName);
    if (!current || !client) return;
    current.refCount -= 1;
    if (current.refCount <= 0) {
      client.unsubscribe(channelName);
      activeChannels.delete(channelName);
    }
  };
}

export function onRealtimeMessage(handler: MessageHandler): () => void {
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
}

export function onRealtimeRead(handler: ReadHandler): () => void {
  readHandlers.add(handler);
  return () => readHandlers.delete(handler);
}

export async function handleRealtimeMessage(
  conversationId: number,
  conversationType: 'individual' | 'group',
  message: ChatMessage,
  merge: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void
): Promise<void> {
  await persistApiMessages(conversationId, conversationType, [message]);
  merge((prev) => dedupeMessages([...prev, message]));
}

export function disconnectRealtime(): void {
  if (pusher) {
    pusher.disconnect();
    pusher = null;
    pusherInitPromise = null;
    connected = false;
    activeChannels.clear();
  }
}
