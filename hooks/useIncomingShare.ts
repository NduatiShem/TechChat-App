import { usePendingShare } from '@/context/PendingShareContext';
import { ShareIntent, type SharePayload } from '@/services/shareIntent';
import { useEffect, useRef } from 'react';
import { Alert, Platform } from 'react-native';

function payloadToAttachment(payload: SharePayload) {
  if (payload.type === 'text') {
    return null;
  }

  const file =
    payload.type === 'file'
      ? payload
      : payload.files[0];

  if (!file) {
    return null;
  }

  return {
    uri: file.uri,
    name: file.fileName,
    type: file.mimeType,
    isImage: file.mimeType.startsWith('image/'),
  };
}

function handleUnsupportedText(text: string) {
  Alert.alert(
    'Shared text',
    text.length > 500 ? `${text.slice(0, 500)}…` : text
  );
}

type UseIncomingShareOptions = {
  enabled?: boolean;
  /** When false, share is queued but picker waits until user is logged in. */
  showPicker?: boolean;
};

/**
 * Subscribes to Android share intents and opens the Send to… picker.
 */
export function useIncomingShare(options: UseIncomingShareOptions = {}) {
  const { enabled = true, showPicker = true } = options;
  const { openSharePicker, setPendingAttachment } = usePendingShare();
  const lastAppliedRef = useRef<string>('');

  useEffect(() => {
    if (!enabled || Platform.OS !== 'android') {
      return;
    }

    const applyPayload = (payload: SharePayload | null) => {
      if (!payload) {
        return;
      }

      const fingerprint =
        payload.type === 'text'
          ? `text:${payload.text}`
          : payload.type === 'file'
            ? `file:${payload.uri}`
            : `files:${payload.files.map((f) => f.uri).join('|')}`;

      if (fingerprint === lastAppliedRef.current) {
        return;
      }
      lastAppliedRef.current = fingerprint;

      if (payload.type === 'text') {
        handleUnsupportedText(payload.text);
        return;
      }

      if (payload.type === 'files' && payload.files.length > 1) {
        console.log(
          `[ShareIntent] received ${payload.files.length} files; sending the first.`
        );
      }

      const attachment = payloadToAttachment(payload);
      if (!attachment) {
        Alert.alert(
          'Unsupported share',
          'This file type is not supported or could not be read.'
        );
        return;
      }

      if (showPicker) {
        openSharePicker(attachment);
      } else {
        setPendingAttachment(attachment);
      }
    };

    ShareIntent.getInitialShare().then(applyPayload);
    const subscription = ShareIntent.addListener(applyPayload);

    return () => {
      subscription.remove();
    };
  }, [enabled, showPicker, openSharePicker, setPendingAttachment]);
}
