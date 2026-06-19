import AsyncStorage from '@react-native-async-storage/async-storage';

const USER_CACHE_KEY = '@techchat_user';

/** Offline fallback when AuthContext user is not loaded yet */
export async function getCachedAuthUserId(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: number | string };
    const id = Number(parsed?.id);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
