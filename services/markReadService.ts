import { groupsAPI, messagesAPI } from '@/services/api';

const MIN_INTERVAL_MS = 30_000;
const RATE_LIMIT_BACKOFF_MS = 60_000;

type MarkReadKey = string;

const lastMarkedAt = new Map<MarkReadKey, number>();
const backoffUntil = new Map<MarkReadKey, number>();
const inFlight = new Map<MarkReadKey, Promise<boolean>>();

export type MarkReadResult = {
  ok: boolean;
  skipped?: boolean;
  rateLimited?: boolean;
};

function shouldSkipMarkRead(key: MarkReadKey): MarkReadResult | null {
  const now = Date.now();
  const backoff = backoffUntil.get(key) ?? 0;
  if (now < backoff) {
    return { ok: false, skipped: true, rateLimited: true };
  }

  const last = lastMarkedAt.get(key) ?? 0;
  if (now - last < MIN_INTERVAL_MS) {
    return { ok: false, skipped: true };
  }

  return null;
}

async function runMarkRead(
  key: MarkReadKey,
  apiCall: () => Promise<unknown>,
): Promise<MarkReadResult> {
  const skip = shouldSkipMarkRead(key);
  if (skip) return skip;

  const pending = inFlight.get(key);
  if (pending) {
    const ok = await pending;
    return { ok, skipped: true };
  }

  const task = (async () => {
    try {
      await apiCall();
      lastMarkedAt.set(key, Date.now());
      backoffUntil.delete(key);
      return true;
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 429) {
        backoffUntil.set(key, Date.now() + RATE_LIMIT_BACKOFF_MS);
        return false;
      }
      throw error;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  const ok = await task;
  return {
    ok,
    rateLimited: !ok && (backoffUntil.get(key) ?? 0) > Date.now(),
  };
}

export function markUserChatAsRead(userId: number): Promise<MarkReadResult> {
  return runMarkRead(`user:${userId}`, () => messagesAPI.markMessagesAsRead(userId));
}

export function markGroupChatAsRead(groupId: number): Promise<MarkReadResult> {
  return runMarkRead(`group:${groupId}`, () => groupsAPI.markMessagesAsRead(groupId));
}

export function isMarkReadRateLimitError(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 429;
}

export function resetMarkReadState(userId?: number, groupId?: number) {
  if (userId != null) {
    const key = `user:${userId}`;
    lastMarkedAt.delete(key);
    backoffUntil.delete(key);
    inFlight.delete(key);
  }
  if (groupId != null) {
    const key = `group:${groupId}`;
    lastMarkedAt.delete(key);
    backoffUntil.delete(key);
    inFlight.delete(key);
  }
}
