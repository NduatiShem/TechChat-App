import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Wrapper for SecureStore with better error handling and compatibility
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return localStorage.getItem(key);
      }
      
      // Check if SecureStore is available
      if (!SecureStore || typeof SecureStore.getItemAsync !== 'function') {
        console.warn('SecureStore is not available, falling back to memory storage');
        return null;
      }
      
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      console.error('Error getting item from secure storage:', error);
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem(key, value);
        return;
      }
      
      // Check if SecureStore is available
      if (!SecureStore || typeof SecureStore.setItemAsync !== 'function') {
        console.warn('SecureStore is not available, cannot store item');
        return;
      }
      
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      console.error('Error setting item in secure storage:', error);
    }
  },

  async deleteItem(key: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        localStorage.removeItem(key);
        return;
      }
      
      // Check if SecureStore is available and has the correct method
      if (!SecureStore) {
        console.warn('SecureStore is not available, cannot delete item');
        return;
      }
      
      // Use deleteItemAsync (standard method in expo-secure-store)
      if (typeof SecureStore.deleteItemAsync === 'function') {
        await SecureStore.deleteItemAsync(key);
      } else {
        console.warn('No delete method available in SecureStore');
      }
    } catch (error) {
      console.error('Error deleting item from secure storage:', error);
    }
  }
};

// Helper function to get auth token
export const getToken = async (key: string = 'auth_token'): Promise<string | null> => {
  return await secureStorage.getItem(key);
};

