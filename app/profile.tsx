import { AppConfig } from '@/config/app.config';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { secureStorage } from '@/utils/secureStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image, Platform, ScrollView,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const options = {
  title: "Profile",
};

export default function ProfileScreen() {
  const { user, logout, refreshUser } = useAuth();
  const { currentTheme, theme, setTheme } = useTheme();
  const [avatarUploading, setAvatarUploading] = useState(false);

  const isDark = currentTheme === 'dark';

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: logout },
      ]
    );
  };

  const getThemeIcon = () => {
    switch (theme) {
      case 'light': return 'weather-sunny';
      case 'dark': return 'weather-night';
      default: return 'theme-light-dark';
    }
  };

  const getThemeText = () => {
    switch (theme) {
      case 'light': return 'Light Mode';
      case 'dark': return 'Dark Mode';
      default: return 'System Mode';
    }
  };

  const cycleTheme = () => {
    const themes: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  const handlePickAvatar = async () => {
    try {
      // Request permission first
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert(
          'Permission Required',
          'Please grant access to your photo library to upload an avatar.',
          [{ text: 'OK' }]
        );
        return;
      }

      // Show action sheet to choose source
      Alert.alert(
        'Change Avatar',
        'Choose an option',
        [
          {
            text: 'Camera',
            onPress: async () => {
              const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
              if (!cameraPermission.granted) {
                Alert.alert('Permission Required', 'Please grant camera access.');
                return;
              }
              await handleImagePicker(ImagePicker.launchCameraAsync);
            },
          },
          {
            text: 'Photo Library',
            onPress: async () => {
              await handleImagePicker(ImagePicker.launchImageLibraryAsync);
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
          },
        ],
        { cancelable: true }
      );
    } catch (error: any) {
      console.error('Avatar picker error:', error);
      Alert.alert('Error', 'Failed to open image picker');
    }
  };

  const handleImagePicker = async (pickerFunction: typeof ImagePicker.launchImageLibraryAsync) => {
    try {
      const result = await pickerFunction({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];

      // Check file size
      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
        Alert.alert('Error', 'Image file size must be less than 5MB');
        return;
      }

      setAvatarUploading(true);

      // Get authentication token
      const token = await secureStorage.getItem('auth_token');
      if (!token) {
        Alert.alert('Error', 'You must be logged in to upload an avatar');
        setAvatarUploading(false);
        return;
      }

      // Create FormData - same format as messages which work
      const formData = new FormData();
      
      // Same format as messages - they use: { uri, name, type }
      formData.append('avatar', {
        uri: asset.uri,
        name: asset.fileName || `avatar_${Date.now()}.jpg`,
        type: asset.type || 'image/jpeg',
      } as any);
      
      console.log('FormData created with:', {
        uri: asset.uri.substring(0, 50) + '...',
        name: asset.fileName || 'avatar.jpg',
        type: asset.type || 'image/jpeg',
      });

      console.log('=== AVATAR UPLOAD START ===');
      console.log('Token exists:', !!token);
      console.log('FormData file:', {
        uri: asset.uri.substring(0, 50) + '...',
        name: asset.fileName || 'avatar.jpg',
        type: asset.type || 'image/jpeg',
        size: asset.fileSize
      });
      
      // FINAL APPROACH: Verify the endpoint route exists first
      // Messages use: /messages - that works
      // Avatar should use: /user/avatar - but maybe the route is different?
      console.log('=== AVATAR UPLOAD DEBUG ===');
      
      const { default: api } = await import('@/services/api');
      const baseURL = api.defaults.baseURL;
      console.log('API Base URL:', baseURL);
      console.log('Attempting endpoint:', `${baseURL}/user/avatar`);
      
      // QUESTION: Is the backend route /api/user/avatar or /api/users/avatar?
      // Check your backend routes/api.php file to confirm the exact route
      
      // Try with exact messages pattern - messages work, so copy exactly
      console.log('Using axios with Content-Type header (same as messages)...');
      
      const response = await api.post('/user/avatar', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 60000,
      });
      
      console.log('Upload success:', response.data);
      
      Alert.alert('Success', 'Avatar updated successfully!');
      await refreshUser();

    } catch (error: any) {
      console.error('=== AVATAR UPLOAD ERROR ===');
      console.error('Error type:', error?.constructor?.name || typeof error);
      console.error('Error message:', error?.message || String(error));
      console.error('Error response:', error?.response?.data);
      console.error('Error status:', error?.response?.status);
      console.error('Error config:', error?.config);
      console.error('Full error:', error);
      
      // Get baseUrl for error message
      let baseUrlForError = '';
      try {
        let apiUrlForError: string;
        if (__DEV__) {
          if (Platform.OS === 'android') {
            apiUrlForError = AppConfig.api.development.physical;
          } else {
            apiUrlForError = AppConfig.api.development.ios;
          }
        } else {
          apiUrlForError = AppConfig.api.production;
        }
        baseUrlForError = apiUrlForError.replace('/api', '');
      } catch {
        baseUrlForError = 'unknown';
      }
      
      let errorMessage = 'Failed to upload avatar.';
      
      if (error.message?.includes('Network request failed')) {
        errorMessage = `Network Error: Cannot connect to server.\n\n` +
          `Please verify:\n` +
          `1. Your server is running\n` +
          `2. Your device is on the same Wi-Fi network\n` +
          `3. The IP address ${baseUrlForError || 'unknown'} is correct\n` +
          `4. Your firewall allows connections\n\n` +
          `Try opening ${baseUrlForError || 'the server URL'} in your device's browser.`;
      } else {
        errorMessage = error.message || errorMessage;
      }
      
      Alert.alert('Upload Failed', errorMessage);
    } finally {
      setAvatarUploading(false);
    }
  };

  return (
    <SafeAreaView
      edges={['top']}
      className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-white'}`}
    >
      <ScrollView
        className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-white'}`}
      >
      {/* User Info */}
      <View
        className={`mx-4 mt-6 p-4 rounded-lg ${
          isDark ? 'bg-gray-800' : 'bg-gray-50'
        }`}
      >
        <View className="flex-row items-center mb-4">
          <TouchableOpacity 
            onPress={handlePickAvatar} 
            disabled={avatarUploading}
            className="relative"
          >
            {user?.avatar_url ? (
              <View className="relative">
                <Image
                    source={{ uri: user.avatar_url }}
                  style={{ width: 64, height: 64, borderRadius: 32, marginRight: 16 }}
                />
                <View className="absolute bottom-0 right-0 bg-blue-500 rounded-full p-1">
                  <MaterialCommunityIcons name="camera" size={12} color="white" />
                </View>
              </View>
            ) : (
              <View className="w-16 h-16 rounded-full bg-primary items-center justify-center mr-4">
                <MaterialCommunityIcons name="account" size={32} color="white" />
              </View>
            )}
            {avatarUploading && (
                <View className="absolute inset-0 bg-black/50 rounded-full items-center justify-center">
                  <ActivityIndicator size="small" color="#fff" />
              </View>
            )}
          </TouchableOpacity>
          <View className="flex-1 ml-2">
              <Text className={`text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Tap to change avatar
            </Text>
              <Text className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {user?.name}
            </Text>
              <Text className={`text-base ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {user?.email}
            </Text>
            {user?.is_admin !== undefined && (
              <View className="flex-row items-center mt-1">
                <MaterialCommunityIcons
                  name={user.is_admin ? 'shield-crown' : 'account'}
                  size={16}
                  color={user.is_admin ? '#39B54A' : (isDark ? '#9CA3AF' : '#6B7280')}
                />
                  <Text className={`ml-1 text-sm ${user.is_admin ? 'text-secondary' : (isDark ? 'text-gray-400' : 'text-gray-500')}`}>
                  {user.is_admin ? 'Admin' : 'User'}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View className="space-y-3">
          <View className="flex-row justify-between items-center">
              <Text className={`text-base ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              Member since
            </Text>
              <Text className={`text-base font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
            </Text>
          </View>
        </View>
      </View>

        {/* Settings */}
      <View className="mx-4 mt-6">
          <Text className={`text-lg font-semibold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Settings
        </Text>

        {/* Theme Toggle */}
        <TouchableOpacity
          onPress={cycleTheme}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-gray-800' : 'bg-gray-50'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name={getThemeIcon()}
              size={24}
                color="#283891"
              />
              <Text className={`ml-3 text-base ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {getThemeText()}
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? '#9CA3AF' : '#6B7280'}
          />
        </TouchableOpacity>

        {/* Logout */}
        <TouchableOpacity
          onPress={handleLogout}
          className={`flex-row items-center justify-between p-4 rounded-lg ${
            isDark ? 'bg-red-900/20' : 'bg-red-50'
          }`}
        >
          <View className="flex-row items-center">
              <MaterialCommunityIcons name="logout" size={24} color="#EF4444" />
            <Text className="ml-3 text-base text-red-600 font-medium">
              Logout
            </Text>
          </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#EF4444" />
        </TouchableOpacity>
      </View>

      {/* App Info */}
      <View className="mx-4 mt-8 mb-8">
          <Text className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            TechChat App v1.0.0
        </Text>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
} 
