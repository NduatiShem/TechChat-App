export type ShareRecipient = {
  key: string;
  type: 'individual' | 'group';
  /** User id or group id used by chat routes and outbox. */
  conversationId: number;
  name: string;
  avatarUrl?: string;
  subtitle?: string;
  lastActivity?: string;
};
