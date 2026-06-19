import * as Sentry from '@sentry/react-native';

let initialized = false;

/**
 * Optional crash reporting — set EXPO_PUBLIC_SENTRY_DSN in EAS secrets / .env.
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn || initialized) return;

  Sentry.init({
    dsn,
    enabled: !__DEV__,
    debug: __DEV__ && process.env.EXPO_PUBLIC_DEBUG_API === 'true',
    tracesSampleRate: 0.2,
    enableAutoSessionTracking: true,
  });
  initialized = true;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }
    Sentry.captureException(error);
  });
}

export { Sentry };
