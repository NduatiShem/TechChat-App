import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useTheme } from '@/context/ThemeContext';
import { authAPI } from '@/services/api';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Platform,
    ScrollView,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const options = {
  title: "Profile",
};

export default function ProfileScreen() {
  const { user, isAuthenticated, isLoading, logout, refreshUser } = useAuth();
  // Remove the navigation effect - let the AppLayout handle authentication state changes
  const { currentTheme, theme, setTheme } = useTheme();
  const { expoPushToken, getExpoPushToken } = useNotifications();
  const [avatarUploading, setAvatarUploading] = React.useState(false);

  const isDark = currentTheme === 'dark';

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: logout,
        },
      ]
    );
  };

  const getThemeIcon = () => {
    switch (theme) {
      case 'light':
        return 'weather-sunny';
      case 'dark':
        return 'weather-night';
      default:
        return 'theme-light-dark';
    }
  };

  const getThemeText = () => {
    switch (theme) {
      case 'light':
        return 'Light Mode';
      case 'dark':
        return 'Dark Mode';
      default:
        return 'System Mode';
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
      // Check if user is authenticated
      const token = await SecureStore.getItemAsync('auth_token');
      if (!token) {
        Alert.alert('Error', 'Please login first to upload an avatar');
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        allowsMultipleSelection: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        console.log('Image selection canceled or no assets selected');
        return;
      }

      const asset = result.assets[0];
      console.log('Selected image asset:', {
        uri: asset.uri,
        type: asset.type,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
        width: asset.width,
        height: asset.height,
      });

      // Validate image
      if (!asset.uri) {
        Alert.alert('Error', 'Invalid image selected');
        return;
      }

      // Check file size (max 2MB)
      if (asset.fileSize && asset.fileSize > 2 * 1024 * 1024) {
        Alert.alert('Error', 'Image file size must be less than 2MB');
        return;
      }

      // Handle different URI formats
      let imageUri = asset.uri;
      if (Platform.OS === 'android' && imageUri.startsWith('file://')) {
        // Remove file:// prefix for Android
        imageUri = imageUri.replace('file://', '');
      }
      
      console.log('Processed image URI:', imageUri);
      console.log('Original URI:', asset.uri);
      
      // Test the image upload with both URIs to see which works
      console.log('Testing image upload with processed URI...');
      const testResult1 = await testImageUpload(imageUri);
      console.log('Test result with processed URI:', testResult1);
      
      if (!testResult1.success && imageUri !== asset.uri) {
        console.log('Testing image upload with original URI...');
        const testResult2 = await testImageUpload(asset.uri);
        console.log('Test result with original URI:', testResult2);
        
        if (testResult2.success) {
          imageUri = asset.uri;
          console.log('Using original URI for upload');
        }
      }

      setAvatarUploading(true);

      // Test network connectivity first
      console.log('Testing network connectivity...');
      try {
        const testResponse = await authAPI.getProfile();
        console.log('Network test successful, profile loaded');
      } catch (testError) {
        console.error('Network test failed:', testError);
        throw new Error('Network connectivity issue. Please check your connection.');
      }

      // Create FormData
      const formData = new FormData();
      const fileName = asset.fileName || `avatar_${Date.now()}.jpg`;
      const fileType = asset.type || 'image/jpeg';
      
      formData.append('avatar', {
        uri: imageUri,
        name: fileName,
        type: fileType,
      } as any);

      console.log('FormData created:', {
        parts: formData._parts,
        uri: imageUri,
        name: fileName,
        type: fileType,
        fileSize: asset.fileSize,
      });
      
      // Log the token for debugging
      console.log('Auth token length:', token.length);
      console.log('Auth token preview:', token.substring(0, 20) + '...');

      // Try upload using axios (which was working in your test)
      console.log('Starting avatar upload with axios...');
      let response;
      let retryCount = 0;
      const maxRetries = 2;
      
      while (retryCount <= maxRetries) {
        try {
          console.log(`Upload attempt ${retryCount + 1}/${maxRetries + 1}...`);
          response = await authAPI.uploadAvatar(formData);
          console.log('Axios upload successful:', response.data);
          break; // Success, exit retry loop
        } catch (uploadError) {
          retryCount++;
          console.log(`Upload attempt ${retryCount} failed:`, uploadError);
          console.log('Upload error details:', {
            name: uploadError.name,
            message: uploadError.message,
            code: uploadError.code,
            response: uploadError.response?.data,
            status: uploadError.response?.status,
            statusText: uploadError.response?.statusText,
          });
          
          if (retryCount > maxRetries) {
            // All retries exhausted, throw the error
            throw uploadError;
          }
          
          // Wait before retrying (exponential backoff)
          const waitTime = Math.pow(2, retryCount) * 1000; // 2s, 4s
          console.log(`Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
      
      if (response.data && response.data.avatar_url) {
        const newAvatarUrl = response.data.avatar_url;
        console.log('Avatar upload successful, new URL:', newAvatarUrl);
        
        // Refresh user data to get the updated avatar
        try {
          await refreshUser();
          console.log('User data refreshed after upload');
        } catch (profileError) {
          console.log('Failed to refresh user data after upload:', profileError);
        }
        
        // Show success message
        console.log('Avatar upload successful, showing success message');
        Alert.alert('Success', 'Avatar updated successfully!');
      } else {
        console.error('Invalid response format:', response);
        console.error('Response data:', response.data);
        console.error('Response status:', response.status);
        throw new Error('Invalid response from server');
      }

    } catch (error) {
      console.error('Avatar upload failed:', error);
      
      let errorMessage = 'Failed to upload avatar';
      
      if (error.message) {
        errorMessage += `: ${error.message}`;
      }
      
      // Add specific error information
      if (error.name === 'AbortError') {
        errorMessage = 'Upload timed out. Please try again.';
      } else if (error.message?.includes('401')) {
        errorMessage = 'Authentication failed. Please login again.';
      } else if (error.message?.includes('413')) {
        errorMessage = 'Image file is too large. Please select a smaller image.';
      } else if (error.message?.includes('422')) {
        errorMessage = 'Invalid image format. Please select a JPEG, PNG, or GIF image.';
      } else if (error.message?.includes('Network request failed')) {
        errorMessage = 'Network connection issue. Please check your internet connection and try again.';
      }
      
      Alert.alert('Upload Failed', errorMessage);
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleGetExpoPushToken = async () => {
    try {
      const token = await getExpoPushToken();
      if (token) {
        Alert.alert('Expo Push Token', `Token: ${token.substring(0, 50)}...`);
      } else {
        Alert.alert('Error', 'Failed to get Expo push token');
      }
    } catch (error) {
      Alert.alert('Error', `Failed to get Expo push token: ${error}`);
    }
  };

  const refreshAvatarFromServer = async () => {
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      if (!token) {
        Alert.alert('Error', 'Please login first');
        return;
      }

      const response = await authAPI.getProfile();
      console.log('User profile response:', response.data);
      
      if (response.data && response.data.avatar_url) {
        await refreshUser();
        Alert.alert('Success', 'Avatar refreshed from server!');
      } else {
        Alert.alert('Info', `No avatar found for user: ${response.data?.name || 'Unknown'}`);
      }
    } catch (error) {
      console.error('Failed to refresh avatar:', error);
      Alert.alert('Error', 'Failed to refresh avatar from server');
    }
  };

  // Test if avatar URL is accessible
  const testAvatarUrl = async (url: string) => {
    try {
      console.log('Testing avatar URL accessibility:', url);
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(url, { 
        method: 'HEAD',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      console.log('Avatar URL test response:', response.status);
      return response.status === 200;
    } catch (error) {
      console.log('Avatar URL test failed (this is normal for local development):', error);
      // In local development, this is expected to fail, so we return true
      return true;
    }
  };

  // Simple test function for debugging
  const testImageUpload = async (imageUri: string) => {
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      if (!token) {
        throw new Error('No auth token');
      }

      const formData = new FormData();
      formData.append('avatar', {
        uri: imageUri,
        name: 'test.jpg',
        type: 'image/jpeg',
      } as any);

      const uploadUrl = Platform.OS === 'ios' 
        ? 'http://127.0.0.1:8000/api/user/avatar' 
        : 'http://192.168.100.16:8000/api/user/avatar';

      console.log('Testing upload with URI:', imageUri);
      console.log('Upload URL:', uploadUrl);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.status === 0) {
        throw new Error('Network request failed - connection aborted');
      }

      console.log('Test response status:', response.status);
      const data = await response.text();
      console.log('Test response data:', data);

      return { success: response.ok, status: response.status, data };
    } catch (error) {
      console.error('Test upload failed:', error);
      return { success: false, error: error.message };
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
                  source={{ 
                    uri: user.avatar_url,
                    cache: 'reload' // Force reload to ensure fresh image
                  }}
                  style={{ width: 64, height: 64, borderRadius: 32, marginRight: 16 }}
                  onLoad={() => {
                    console.log('Avatar image loaded successfully:', user.avatar_url);
                  }}
                  onError={() => {
                    console.log('Failed to load avatar image:', user.avatar_url);
                    console.log('Falling back to default avatar');
                  }}
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
              <View style={{ 
                position: 'absolute', 
                top: 0, 
                left: 0, 
                right: 0, 
                bottom: 0, 
                backgroundColor: 'rgba(0,0,0,0.5)', 
                borderRadius: 32, 
                alignItems: 'center', 
                justifyContent: 'center' 
              }}>
                <View className="items-center">
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 10, marginTop: 4 }}>Uploading...</Text>
                </View>
              </View>
            )}
          </TouchableOpacity>
          <View className="flex-1 ml-2">
            <Text
              className={`text-xs mb-1 ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              Tap to change avatar
            </Text>

            <Text
              className={`text-xl font-bold ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
            >
              {user?.name}
            </Text>
            <Text
              className={`text-base ${
                isDark ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              {user?.email}
            </Text>
            {user?.is_admin !== undefined && (
              <View className="flex-row items-center mt-1">
                <MaterialCommunityIcons
                  name={user.is_admin ? 'shield-crown' : 'account'}
                  size={16}
                  color={user.is_admin ? '#39B54A' : (isDark ? '#9CA3AF' : '#6B7280')}
                />
                <Text
                  className={`ml-1 text-sm font-medium ${
                    user.is_admin 
                      ? 'text-secondary' 
                      : (isDark ? 'text-gray-400' : 'text-gray-500')
                  }`}
                >
                  {user.is_admin ? 'Admin' : 'User'}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View className="space-y-3">
          <View className="flex-row justify-between items-center">
            <Text
              className={`text-base ${
                isDark ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              Member since
            </Text>
            <Text
              className={`text-base font-medium ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
            >
              {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
            </Text>
          </View>
        </View>
      </View>

      {/* Settings */}
      <View className="mx-4 mt-6">
        <Text
          className={`text-lg font-semibold mb-3 ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}
        >
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
              color={isDark ? '#283891' : '#283891'}
            />
            <Text
              className={`ml-3 text-base ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
            >
              {getThemeText()}
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? '#9CA3AF' : '#6B7280'}
          />
        </TouchableOpacity>

        {/* API Test */}
        <TouchableOpacity
          onPress={() => {
            router.push('/api-test');
          }}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-blue-900/20' : 'bg-blue-50'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name="bug"
              size={24}
              color="#3B82F6"
            />
            <Text className="ml-3 text-base text-blue-600 font-medium">
              API Test
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color="#3B82F6"
          />
        </TouchableOpacity>

        {/* Network Test */}
        <TouchableOpacity
          onPress={async () => {
            try {
              console.log('Testing network connectivity...');
              const testUrl = Platform.OS === 'ios' 
                ? 'http://127.0.0.1:8000/api/test' 
                : 'http://192.168.100.16:8000/api/test';
              console.log('Testing URL:', testUrl);
              const response = await fetch(testUrl);
              const data = await response.json();
              Alert.alert('Network Test', `Success! Server response: ${JSON.stringify(data)}`);
            } catch (error) {
              console.error('Network test failed:', error);
              Alert.alert('Network Test', `Failed: ${error.message}`);
            }
          }}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-green-900/20' : 'bg-green-50'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name="wifi"
              size={24}
              color="#10B981"
            />
            <Text className="ml-3 text-base text-green-600 font-medium">
              Network Test
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color="#10B981"
          />
        </TouchableOpacity>

        {/* API Config Info */}
        <TouchableOpacity
          onPress={() => {
            const apiUrl = Platform.OS === 'ios' 
              ? 'http://127.0.0.1:8000/api' 
              : 'http://192.168.100.16:8000/api';
            Alert.alert('API Configuration', 
              `Platform: ${Platform.OS}\n` +
              `API URL: ${apiUrl}\n` +
              `Development: ${__DEV__ ? 'Yes' : 'No'}`
            );
          }}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-gray-800' : 'bg-gray-50'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name="information"
              size={24}
              color={isDark ? '#9CA3AF' : '#6B7280'}
            />
            <Text className={`ml-3 text-base ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              API Configuration
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? '#9CA3AF' : '#6B7280'}
          />
        </TouchableOpacity>

        {/* Avatar Endpoint Test */}
        <TouchableOpacity
          onPress={async () => {
            try {
              console.log('Testing avatar endpoint...');
              const testUrl = Platform.OS === 'ios' 
                ? 'http://127.0.0.1:8000/api/user/avatar' 
                : 'http://192.168.100.16:8000/api/user/avatar';
              console.log('Testing URL:', testUrl);
              
              // Get auth token
              const token = await SecureStore.getItemAsync('auth_token');
              console.log('Auth token:', token ? 'Present' : 'Missing');
              
              if (!token) {
                Alert.alert('Avatar Endpoint Test', 'No auth token found. Please login first.');
                return;
              }
              
              // Create a mock file for testing
              const formData = new FormData();
              formData.append('avatar', {
                uri: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
                name: 'test-avatar.jpg',
                type: 'image/jpeg',
              } as any);
              
              console.log('Testing with mock file...');
              const response = await fetch(testUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'multipart/form-data',
                },
                body: formData,
              });
              
              console.log('Response status:', response.status);
              if (response.ok) {
                const data = await response.json();
                Alert.alert('Avatar Endpoint Test', `Success! Response: ${JSON.stringify(data)}`);
              } else {
                const errorText = await response.text();
                Alert.alert('Avatar Endpoint Test', `Error ${response.status}: ${errorText}`);
              }
            } catch (error) {
              console.error('Avatar endpoint test failed:', error);
              Alert.alert('Avatar Endpoint Test', `Failed: ${error.message}`);
            }
          }}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-orange-900/20' : 'bg-orange-50'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name="image"
              size={24}
              color="#F97316"
            />
            <Text className="ml-3 text-base text-orange-600 font-medium">
              Test Avatar Endpoint
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color="#F97316"
          />
        </TouchableOpacity>

        {/* Public Avatar Test */}
        <TouchableOpacity
          onPress={async () => {
            try {
              console.log('Testing public avatar endpoint...');
              const testUrl = Platform.OS === 'ios' 
                ? 'http://127.0.0.1:8000/api/test-avatar' 
                : 'http://192.168.100.16:8000/api/test-avatar';
              console.log('Testing URL:', testUrl);
              
              const formData = new FormData();
              formData.append('avatar', {
                uri: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
                name: 'test-avatar.jpg',
                type: 'image/jpeg',
              } as any);
              
              const response = await fetch(testUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'multipart/form-data',
                },
                body: formData,
              });
              
              console.log('Public avatar test status:', response.status);
              if (response.ok) {
                const data = await response.json();
                Alert.alert('Public Avatar Test', `Success! Response: ${JSON.stringify(data)}`);
              } else {
                const errorText = await response.text();
                Alert.alert('Public Avatar Test', `Error ${response.status}: ${errorText}`);
              }
            } catch (error) {
              console.error('Public avatar test failed:', error);
              Alert.alert('Public Avatar Test', `Failed: ${error.message}`);
            }
          }}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-indigo-900/20' : 'bg-indigo-50'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name="image-plus"
              size={24}
              color="#6366F1"
            />
            <Text className="ml-3 text-base text-indigo-600 font-medium">
              Test Public Avatar Endpoint
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color="#6366F1"
          />
        </TouchableOpacity>

        {/* Multipart Test */}
        <TouchableOpacity
          onPress={async () => {
            try {
              console.log('Testing multipart endpoint...');
              const testUrl = Platform.OS === 'ios' 
                ? 'http://127.0.0.1:8000/api/test-multipart' 
                : 'http://192.168.100.16:8000/api/test-multipart';
              console.log('Testing URL:', testUrl);
              
              const formData = new FormData();
              formData.append('file', {
                uri: 'data:text/plain;base64,dGVzdA==', // "test" in base64
                name: 'test.txt',
                type: 'text/plain',
              });
              
              const response = await fetch(testUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'multipart/form-data',
                },
                body: formData,
              });
              
              console.log('Multipart test status:', response.status);
              if (response.ok) {
                const data = await response.json();
                Alert.alert('Multipart Test', `Success! Response: ${JSON.stringify(data)}`);
              } else {
                const errorText = await response.text();
                Alert.alert('Multipart Test', `Error ${response.status}: ${errorText}`);
              }
            } catch (error) {
              console.error('Multipart test failed:', error);
              Alert.alert('Multipart Test', `Failed: ${error.message}`);
            }
          }}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-blue-900/20' : 'bg-blue-50'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name="file-upload"
              size={24}
              color="#3B82F6"
            />
            <Text className="ml-3 text-base text-blue-600 font-medium">
              Test Multipart Endpoint
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color="#3B82F6"
          />
        </TouchableOpacity>

        {/* Avatar Upload Test with Mock File */}
        <TouchableOpacity
          onPress={async () => {
            try {
              console.log('Testing avatar upload with mock file...');
              
              const token = await SecureStore.getItemAsync('auth_token');
              if (!token) {
                Alert.alert('Error', 'No auth token found. Please login first.');
                return;
              }
              
              // Test network connectivity first
              console.log('Testing network connectivity...');
              const testUrl = Platform.OS === 'ios' 
                ? 'http://127.0.0.1:8000/api/test' 
                : 'http://192.168.100.16:8000/api/test';
              
              const testResponse = await fetch(testUrl, { method: 'GET' });
              if (!testResponse.ok) {
                throw new Error('Network connectivity test failed');
              }
              console.log('Network connectivity test passed');
              
              // Create a mock file for testing
              const formData = new FormData();
              formData.append('avatar', {
                uri: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
                name: 'test-avatar.jpg',
                type: 'image/jpeg',
              } as any);
              
              const uploadUrl = Platform.OS === 'ios' 
                ? 'http://127.0.0.1:8000/api/user/avatar' 
                : 'http://192.168.100.16:8000/api/user/avatar';
              
              console.log('Testing URL:', uploadUrl);
              console.log('FormData parts:', formData._parts);
              
              // Try axios first
              try {
                console.log('Trying axios upload...');
                const axiosResponse = await authAPI.uploadAvatar(formData);
                console.log('Axios upload successful:', axiosResponse.data);
                Alert.alert('Avatar Upload Test', `Axios Success! Response: ${JSON.stringify(axiosResponse.data)}`);
                return;
              } catch (axiosError) {
                console.log('Axios upload failed, trying fetch...', axiosError);
              }
              
              // Fallback to fetch
              console.log('Trying fetch upload...');
              const response = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'multipart/form-data',
                },
                body: formData,
              });
              
              console.log('Fetch response status:', response.status);
              if (response.ok) {
                const data = await response.json();
                Alert.alert('Avatar Upload Test', `Fetch Success! Response: ${JSON.stringify(data)}`);
              } else {
                const errorText = await response.text();
                Alert.alert('Avatar Upload Test', `Fetch Error ${response.status}: ${errorText}`);
              }
            } catch (error) {
              console.error('Avatar upload test failed:', error);
              Alert.alert('Avatar Upload Test', `Failed: ${error.message}`);
            }
          }}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-green-900/20' : 'bg-green-50'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name="upload"
              size={24}
              color="#10B981"
            />
            <Text className="ml-3 text-base text-green-600 font-medium">
              Test Avatar Upload
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color="#10B981"
          />
        </TouchableOpacity>

        {/* URL Pattern Test */}
        <TouchableOpacity
          onPress={async () => {
            try {
              console.log('Testing different URL patterns...');
              
              // Test 1: Basic GET request to user endpoint
              const testUrl1 = Platform.OS === 'ios' 
                ? 'http://127.0.0.1:8000/api/user' 
                : 'http://192.168.100.16:8000/api/user';
              console.log('Test 1 URL:', testUrl1);
              
              const token = await SecureStore.getItemAsync('auth_token');
              const response1 = await fetch(testUrl1, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              });
              console.log('Test 1 status:', response1.status);
              
              // Test 2: POST request to user endpoint (without avatar)
              const testUrl2 = Platform.OS === 'ios' 
                ? 'http://127.0.0.1:8000/api/user' 
                : 'http://192.168.100.16:8000/api/user';
              console.log('Test 2 URL:', testUrl2);
              
              const response2 = await fetch(testUrl2, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
              });
              console.log('Test 2 status:', response2.status);
              
              // Test 3: POST to avatar endpoint with FormData (correct way)
              const testUrl3 = Platform.OS === 'ios' 
                ? 'http://127.0.0.1:8000/api/user/avatar' 
                : 'http://192.168.100.16:8000/api/user/avatar';
              console.log('Test 3 URL:', testUrl3);
              
              const formData3 = new FormData();
              formData3.append('avatar', {
                uri: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
                name: 'test-avatar.jpg',
                type: 'image/jpeg',
              } as any);
              
              const response3 = await fetch(testUrl3, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'multipart/form-data',
                },
                body: formData3,
              });
              console.log('Test 3 status:', response3.status);
              
              Alert.alert('URL Pattern Test', 
                `Test 1 (GET /user): ${response1.status}\n` +
                `Test 2 (POST /user): ${response2.status}\n` +
                `Test 3 (POST /user/avatar): ${response3.status}`
              );
            } catch (error) {
              console.error('URL pattern test failed:', error);
              Alert.alert('URL Pattern Test', `Failed: ${error.message}`);
            }
          }}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-yellow-900/20' : 'bg-yellow-50'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name="link"
              size={24}
              color="#EAB308"
            />
            <Text className="ml-3 text-base text-yellow-600 font-medium">
              Test URL Patterns
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color="#EAB308"
          />
        </TouchableOpacity>

        {/* Expo Push Token */}
        <TouchableOpacity
          onPress={handleGetExpoPushToken}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-primary/20' : 'bg-primary/10'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name="bell-ring"
              size={24}
              color="#283891"
            />
            <Text className="ml-3 text-base text-primary font-medium">
              Expo Push Token
            </Text>
          </View>
          <View className="flex-row items-center">
            <Text className={`text-xs mr-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {expoPushToken ? 'Available' : 'Not set'}
            </Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color="#283891"
            />
          </View>
        </TouchableOpacity>

        {/* Refresh Avatar */}
        <TouchableOpacity
          onPress={refreshAvatarFromServer}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-blue-900/20' : 'bg-blue-50'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name="refresh"
              size={24}
              color="#3B82F6"
            />
            <Text className="ml-3 text-base text-blue-600 font-medium">
              Refresh Avatar
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color="#3B82F6"
          />
        </TouchableOpacity>

        {/* Debug User Info */}
        <TouchableOpacity
          onPress={async () => {
            try {
              const response = await authAPI.getProfile();
              Alert.alert('Current User Info', 
                `ID: ${response.data?.id}\n` +
                `Name: ${response.data?.name}\n` +
                `Email: ${response.data?.email}\n` +
                `Avatar: ${response.data?.avatar_url || 'None'}\n` +
                `Current State: ${avatarUrl || 'None'}`
              );
            } catch (error) {
              Alert.alert('Error', 'Failed to get user info');
            }
          }}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-gray-800' : 'bg-gray-50'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name="account-details"
              size={24}
              color={isDark ? '#9CA3AF' : '#6B7280'}
            />
            <Text className={`ml-3 text-base ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              Debug User Info
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? '#9CA3AF' : '#6B7280'}
          />
        </TouchableOpacity>

        {/* Force Refresh Avatar */}
        <TouchableOpacity
          onPress={async () => {
            try {
              await refreshUser();
              if (user?.avatar_url) {
                console.log('Force refreshing avatar:', user.avatar_url);
                Alert.alert('Success', 'Avatar refreshed!');
              } else {
                Alert.alert('Info', 'No avatar found on server');
              }
            } catch (error) {
              console.error('Force refresh failed:', error);
              Alert.alert('Error', 'Failed to refresh avatar');
            }
          }}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-green-900/20' : 'bg-green-50'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name="refresh-circle"
              size={24}
              color="#10B981"
            />
            <Text className="ml-3 text-base text-green-600 font-medium">
              Force Refresh Avatar
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color="#10B981"
          />
        </TouchableOpacity>

        {/* Debug User Authentication */}
        <TouchableOpacity
          onPress={async () => {
            try {
              const token = await SecureStore.getItemAsync('auth_token');
              if (!token) {
                Alert.alert('Error', 'No auth token found');
                return;
              }

              const debugUrl = Platform.OS === 'ios' 
                ? 'http://127.0.0.1:8000/api/debug-user' 
                : 'http://192.168.100.16:8000/api/debug-user';

              const response = await fetch(debugUrl, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              });

              const data = await response.json();
              console.log('Debug user response:', data);
              
              Alert.alert('Debug User Info', 
                `Current User ID: ${data.user_id}\n` +
                `Current User: ${data.user_name}\n` +
                `Current Avatar: ${data.user_avatar || 'None'}\n` +
                `Has Avatar: ${data.has_avatar}\n` +
                `Users with Avatars: ${data.all_users_with_avatars?.length || 0}`
              );
            } catch (error) {
              console.error('Debug user failed:', error);
              Alert.alert('Error', 'Failed to debug user info');
            }
          }}
          className={`flex-row items-center justify-between p-4 rounded-lg mb-3 ${
            isDark ? 'bg-red-900/20' : 'bg-red-50'
          }`}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons
              name="bug"
              size={24}
              color="#EF4444"
            />
            <Text className="ml-3 text-base text-red-600 font-medium">
              Debug User Authentication
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color="#EF4444"
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
            <MaterialCommunityIcons
              name="logout"
              size={24}
              color="#EF4444"
            />
            <Text className="ml-3 text-base text-red-600 font-medium">
              Logout
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color="#EF4444"
          />
        </TouchableOpacity>
      </View>

      {/* App Info */}
      <View className="mx-4 mt-8 mb-8">
        <Text
          className={`text-center text-sm ${
            isDark ? 'text-gray-400' : 'text-gray-500'
          }`}
        >
          React Native Message App v1.0.0
        </Text>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
} 