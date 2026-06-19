/**
 * Central logging — production builds stay quiet unless debug flags are set.
 * Phase 0: replace ad-hoc console.log in hot paths with logger.debug().
 */

const debugApi = process.env.EXPO_PUBLIC_DEBUG_API === 'true';
const debugChat = process.env.EXPO_PUBLIC_DEBUG_CHAT === 'true';

export function isDebugEnabled(scope?: 'api' | 'chat'): boolean {
  if (__DEV__) return true;
  if (scope === 'api') return debugApi;
  if (scope === 'chat') return debugChat;
  return debugApi || debugChat;
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (__DEV__ || debugApi || debugChat) {
      console.log(...args);
    }
  },
  debugApi: (...args: unknown[]) => {
    if (__DEV__ || debugApi) console.log(...args);
  },
  debugChat: (...args: unknown[]) => {
    if (__DEV__ || debugChat) console.log(...args);
  },
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
