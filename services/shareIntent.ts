import AppConfig from '@/config/app.config';
import { isShareFileAllowed, resolveShareMime } from '@/utils/shareMimeUtils';
import * as FileSystem from 'expo-file-system/legacy';
import {
  parseShareIntent,
  ShareIntentModule,
  type ShareIntent as ParsedShareIntent,
} from 'expo-share-intent';
import { Platform } from 'react-native';

export type ShareFilePayload = {
  uri: string;
  mimeType: string;
  fileName: string;
};

export type SharePayload =
  | { type: 'file'; mimeType: string; uri: string; fileName: string }
  | { type: 'files'; files: ShareFilePayload[] }
  | { type: 'text'; text: string };

export type ShareListener = (payload: SharePayload | null) => void;

let initialConsumed = false;
let pendingInitial: SharePayload | null = null;
const listeners = new Set<ShareListener>();

function emit(payload: SharePayload | null) {
  listeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.warn('[ShareIntent] listener error', error);
    }
  });
}

async function persistSharedUri(uri: string, fileName: string): Promise<string> {
  if (!uri) {
    throw new Error('Missing shared file URI');
  }
  if (uri.startsWith('file://')) {
    return uri;
  }

  const safeName = fileName.replace(/[^\w.\-()+]/g, '_') || 'shared_file';
  const sharedDir = `${FileSystem.cacheDirectory}shared/`;
  await FileSystem.makeDirectoryAsync(sharedDir, { intermediates: true });
  const dest = `${sharedDir}${Date.now()}_${safeName}`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}

function rawFilesFromIntent(raw: ParsedShareIntent): ShareFilePayload[] {
  return (raw.files ?? [])
    .map((file) => {
      const fileName = file.fileName || 'shared_file';
      const mimeType = resolveShareMime(file.mimeType, fileName);
      return {
        uri: file.path || '',
        mimeType,
        fileName,
      };
    })
    .filter((file) => !!file.uri);
}

export async function normalizeShareIntent(
  raw: ParsedShareIntent
): Promise<SharePayload | null> {
  if (raw.text && !(raw.files?.length)) {
    return { type: 'text', text: raw.text };
  }

  const rawFiles = rawFilesFromIntent(raw);
  if (!rawFiles.length) {
    return null;
  }

  const supported = rawFiles.filter((file) => isShareFileAllowed(file.mimeType, file.fileName));
  if (!supported.length) {
    console.warn('[ShareIntent] unsupported MIME type(s)', rawFiles.map((f) => f.mimeType));
    return null;
  }

  const persisted: ShareFilePayload[] = [];
  for (const file of supported) {
    try {
      const uri = await persistSharedUri(file.uri, file.fileName);
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && 'size' in info && typeof info.size === 'number') {
        if (info.size > AppConfig.settings.maxFileSize) {
          console.warn('[ShareIntent] file exceeds max size', file.fileName);
          continue;
        }
      }
      persisted.push({ ...file, uri });
    } catch (error) {
      console.warn('[ShareIntent] could not read shared URI', file.uri, error);
    }
  }

  if (!persisted.length) {
    return null;
  }

  if (persisted.length === 1) {
    const file = persisted[0];
    return {
      type: 'file',
      mimeType: file.mimeType,
      uri: file.uri,
      fileName: file.fileName,
    };
  }

  return { type: 'files', files: persisted };
}

export function deliverSharePayload(payload: SharePayload | null) {
  if (!payload) {
    return;
  }
  if (!initialConsumed) {
    pendingInitial = payload;
  }
  emit(payload);
}

export const ShareIntent = {
  async getInitialShare(): Promise<SharePayload | null> {
    if (Platform.OS !== 'android') {
      return null;
    }
    if (initialConsumed) {
      return null;
    }

    ShareIntent.refreshFromNative();

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (pendingInitial) {
        initialConsumed = true;
        const value = pendingInitial;
        pendingInitial = null;
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    initialConsumed = true;
    return null;
  },

  addListener(handler: ShareListener) {
    listeners.add(handler);
    return {
      remove: () => {
        listeners.delete(handler);
      },
    };
  },

  /** Used by ShareIntentBridge when expo-share-intent delivers a payload. */
  async handleParsedShareIntent(raw: ParsedShareIntent): Promise<void> {
    try {
      const payload = await normalizeShareIntent(raw);
      deliverSharePayload(payload);
    } catch (error) {
      console.warn('[ShareIntent] failed to handle share', error);
      deliverSharePayload(null);
    }
  },

  /** Optional direct native refresh (Android cold start). */
  refreshFromNative() {
    if (Platform.OS !== 'android' || !ShareIntentModule) {
      return;
    }
    ShareIntentModule.getShareIntent('');
  },

  /** Parse native module event payload (tests / advanced use). */
  parseNativeValue(value: unknown): ParsedShareIntent {
    return parseShareIntent(value as string, {});
  },
};
