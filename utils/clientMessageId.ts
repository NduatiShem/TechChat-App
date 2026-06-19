import * as Crypto from 'expo-crypto';

/** RFC4122 v4 UUID for idempotent message sends */
export function generateClientMessageId(): string {
  return Crypto.randomUUID();
}
