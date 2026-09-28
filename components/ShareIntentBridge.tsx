import { ShareIntent } from '@/services/shareIntent';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * Connects expo-share-intent to the ShareIntent JS API (getInitialShare / addListener).
 * Must render inside ShareIntentProvider.
 */
export function ShareIntentBridge() {
  const { hasShareIntent, shareIntent, isReady, resetShareIntent } = useShareIntentContext();
  const lastHandledRef = useRef<string>('');

  useEffect(() => {
    if (Platform.OS === 'android' && isReady) {
      ShareIntent.refreshFromNative();
    }
  }, [isReady]);

  useEffect(() => {
    if (!hasShareIntent) {
      return;
    }

    const fingerprint = JSON.stringify({
      text: shareIntent.text,
      files: shareIntent.files?.map((f) => [f.path, f.fileName, f.mimeType]),
    });

    if (fingerprint === lastHandledRef.current) {
      return;
    }
    lastHandledRef.current = fingerprint;

    void ShareIntent.handleParsedShareIntent(shareIntent).finally(() => {
      // Clear native state only after JS has copied the shared file to cache.
      resetShareIntent(true);
    });
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  return null;
}
