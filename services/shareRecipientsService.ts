import type { ShareRecipient } from '@/types/shareRecipient';
import { conversationsAPI, groupsAPI, usersAPI } from '@/services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CONVERSATIONS_CACHE_KEY = '@techchat_conversations';
const GROUPS_CACHE_KEY = '@techchat_groups';

function parseDate(value?: string): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function mapIndividual(conv: Record<string, unknown>): ShareRecipient | null {
  const nestedUser = conv.user as { name?: string; avatar_url?: string } | undefined;
  const userId = Number(conv.user_id ?? conv.id);
  if (!userId) return null;
  const name = String(conv.name ?? nestedUser?.name ?? 'User');
  return {
    key: `user-${userId}`,
    type: 'individual',
    conversationId: userId,
    name,
    avatarUrl: (conv.avatar_url ?? nestedUser?.avatar_url) as string | undefined,
    subtitle: conv.email ? String(conv.email) : undefined,
    lastActivity: (conv.last_message_date ?? conv.updated_at ?? conv.created_at) as
      | string
      | undefined,
  };
}

function mapGroup(group: Record<string, unknown>): ShareRecipient | null {
  const groupId = Number(group.id);
  if (!groupId) return null;
  return {
    key: `group-${groupId}`,
    type: 'group',
    conversationId: groupId,
    name: String(group.name ?? 'Group'),
    avatarUrl: group.avatar_url as string | undefined,
    subtitle: group.description ? String(group.description) : 'Group',
    lastActivity: (group.last_message_date ?? group.updated_at ?? group.created_at) as
      | string
      | undefined,
  };
}

function dedupeRecipients(list: ShareRecipient[]): ShareRecipient[] {
  const seen = new Map<string, ShareRecipient>();
  for (const item of list) {
    seen.set(item.key, item);
  }
  return Array.from(seen.values()).sort(
    (a, b) => parseDate(b.lastActivity) - parseDate(a.lastActivity)
  );
}

async function loadFromCache(): Promise<ShareRecipient[]> {
  const recipients: ShareRecipient[] = [];

  try {
    const convRaw = await AsyncStorage.getItem(CONVERSATIONS_CACHE_KEY);
    if (convRaw) {
      const convs = JSON.parse(convRaw);
      if (Array.isArray(convs)) {
        for (const conv of convs) {
          if (conv?.is_group) continue;
          const mapped = mapIndividual(conv);
          if (mapped) recipients.push(mapped);
        }
      }
    }
  } catch (error) {
    console.warn('[ShareRecipients] cache conversations failed', error);
  }

  try {
    const groupsRaw = await AsyncStorage.getItem(GROUPS_CACHE_KEY);
    if (groupsRaw) {
      const groups = JSON.parse(groupsRaw);
      if (Array.isArray(groups)) {
        for (const group of groups) {
          const mapped = mapGroup(group);
          if (mapped) recipients.push(mapped);
        }
      }
    }
  } catch (error) {
    console.warn('[ShareRecipients] cache groups failed', error);
  }

  return dedupeRecipients(recipients);
}

async function loadFromApi(): Promise<ShareRecipient[]> {
  const recipients: ShareRecipient[] = [];

  try {
    const convRes = await conversationsAPI.getAll();
    let data = convRes.data?.data ?? convRes.data;
    if (data && !Array.isArray(data) && typeof data === 'object') {
      const keys = Object.keys(data).filter((k) => !Number.isNaN(Number(k)));
      data = keys.length ? keys.map((k) => data[k]) : [data];
    }
    if (Array.isArray(data)) {
      for (const conv of data) {
        if (conv?.is_group) {
          const mapped = mapGroup(conv);
          if (mapped) recipients.push(mapped);
        } else {
          const mapped = mapIndividual(conv);
          if (mapped) recipients.push(mapped);
        }
      }
    }
  } catch (error) {
    console.warn('[ShareRecipients] API conversations failed', error);
  }

  if (recipients.filter((r) => r.type === 'group').length === 0) {
    try {
      const groupsRes = await groupsAPI.getAll();
      const groups = groupsRes.data?.data ?? groupsRes.data;
      if (Array.isArray(groups)) {
        for (const group of groups) {
          const mapped = mapGroup(group);
          if (mapped) recipients.push(mapped);
        }
      }
    } catch (error) {
      console.warn('[ShareRecipients] API groups failed', error);
    }
  }

  return dedupeRecipients(recipients);
}

export async function loadShareRecipients(): Promise<ShareRecipient[]> {
  const cached = await loadFromCache();
  if (cached.length > 0) {
    return cached;
  }
  return loadFromApi();
}

export async function searchShareRecipients(query: string): Promise<ShareRecipient[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return loadShareRecipients();
  }

  const base = await loadShareRecipients();
  const lower = trimmed.toLowerCase();
  const localMatches = base.filter(
    (r) =>
      r.name.toLowerCase().includes(lower) ||
      (r.subtitle?.toLowerCase().includes(lower) ?? false)
  );

  if (localMatches.length >= 5) {
    return localMatches;
  }

  try {
    const res = await usersAPI.getAll(trimmed);
    const users = res.data?.data ?? res.data;
    if (!Array.isArray(users)) {
      return localMatches;
    }
    const fromUsers: ShareRecipient[] = users.map((u: Record<string, unknown>) => ({
      key: `user-${Number(u.id)}`,
      type: 'individual' as const,
      conversationId: Number(u.id),
      name: String(u.name ?? 'User'),
      avatarUrl: u.avatar_url as string | undefined,
      subtitle: u.email ? String(u.email) : undefined,
    }));
    return dedupeRecipients([...localMatches, ...fromUsers]);
  } catch (error) {
    console.warn('[ShareRecipients] user search failed', error);
    return localMatches;
  }
}
