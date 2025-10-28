import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { authAPI } from '@/services/api';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    ScrollView,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DirectAvatarUpload from '../components/DirectAvatarUpload';

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
      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
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
      if (asset.fileSize && asset.fileSize > 2 * 1024 * 1024) {
        Alert.alert('Error', 'Image file size must be less than 2MB');
        return;
      }

      setAvatarUploading(true);

      // Create FormData - EXACTLY like working message attachments
      const formData = new FormData();
      
      // Ensure we have a valid file name with extension
      const fileName = asset.fileName || `avatar_${Date.now()}.jpg`;
      
      // Ensure we have a valid MIME type - CRITICAL for Laravel to recognize as file
      const fileType = asset.type || 'image/jpeg';
      
      console.log('Creating FormData with:', {
        uri: asset.uri,
        name: fileName,
        type: fileType
      });
      
      // Add file with proper content-type - EXACTLY like working message attachments
      formData.append('avatar', {
        uri: asset.uri,
        name: fileName,
        type: fileType,
      } as any);

      console.log('AVATAR: About to call uploadAvatar');
      
      // Upload
      const response = await authAPI.uploadAvatar(formData);
      
      console.log('AVATAR: Upload completed successfully');
      
      Alert.alert('Success', 'Avatar updated successfully!');
      await refreshUser();

    } catch (error: any) {
      console.error('Avatar upload error:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Failed to upload avatar';
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

        {/* Direct Avatar Upload Component */}
        <View className="mx-4 mt-6 mb-6 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <DirectAvatarUpload onSuccess={refreshUser} />
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
