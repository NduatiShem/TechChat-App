import * as FileSystem from 'expo-file-system/legacy';

/**
 * Copy a picked/shared file into app cache so uploads survive content:// expiry and cache eviction.
 */
export async function persistAttachmentForUpload(
  uri: string,
  fileName: string
): Promise<string> {
  if (!uri) {
    throw new Error('Missing attachment URI');
  }
  if (uri.startsWith('file://')) {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      return uri;
    }
  }

  const safeName = (fileName || 'attachment').replace(/[^\w.\-()+]/g, '_');
  const dir = `${FileSystem.cacheDirectory}outgoing/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const dest = `${dir}${Date.now()}_${safeName}`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}
