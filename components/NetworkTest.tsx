import { AppConfig } from '@/config/app.config';
import { useTheme } from '@/context/ThemeContext';
import { Device } from 'expo-device';
import React, { useState } from 'react';
import { Alert, Platform, Text, TouchableOpacity, View } from 'react-native';

export default function NetworkTest() {
  const { currentTheme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const isDark = currentTheme === 'dark';

  const testNetworkConnection = async () => {
    setIsLoading(true);
    
    // Use different URLs based on device type
    let testUrl;
    if (Device && Device.isDevice) {
      // Physical device - use the physical IP
      testUrl = AppConfig.api.development.physical.replace('/api', '/api/test');
    } else {
      // Simulator/Emulator - use platform-specific URLs
      if (Platform.OS === 'ios') {
        testUrl = AppConfig.api.development.ios.replace('/api', '/api/test');
      } else {
        testUrl = AppConfig.api.development.android.replace('/api', '/api/test');
      }
    }
    
    try {
      // Test basic connectivity
      const response = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        timeout: 10000,
      });
      
      if (response.ok) {
        const data = await response.json();
        Alert.alert('✅ Success', `Network connection working!\n\nResponse: ${JSON.stringify(data, null, 2)}`);
      } else {
        Alert.alert('❌ Error', `HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Network test error:', error);
      Alert.alert('❌ Network Error', `Failed to connect: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const testLoginEndpoint = async () => {
    setIsLoading(true);
    
    // Use different URLs based on platform
    const loginUrl = Platform.OS === 'ios' 
      ? AppConfig.api.development.ios.replace('/api', '/api/auth/login')  // iOS Simulator
      : AppConfig.api.development.physical.replace('/api', '/api/auth/login');  // Physical devices (Android/iOS)
    
    try {
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          email: 'super.admin@healthclassique.com',
          password: 'Nairobi@123'
        }),
        timeout: 10000,
      });
      
      if (response.ok) {
        const data = await response.json();
        Alert.alert('✅ Login Test Success', `Login endpoint working!\n\nResponse: ${JSON.stringify(data, null, 2)}`);
      } else {
        const errorData = await response.text();
        Alert.alert('❌ Login Error', `HTTP ${response.status}: ${response.statusText}\n\nResponse: ${errorData}`);
      }
    } catch (error) {
      console.error('Login test error:', error);
      Alert.alert('❌ Login Network Error', `Failed to connect: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View className={`p-4 ${isDark ? 'bg-gray-800' : 'bg-gray-100'} rounded-lg mb-4`}>
      <Text className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
        Network Connectivity Test
      </Text>
      
      <Text className={`text-sm mb-4 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
        Testing connection to: {Platform.OS === 'ios' ? AppConfig.api.development.ios : AppConfig.api.development.physical}
      </Text>
      
      <TouchableOpacity
        onPress={testNetworkConnection}
        disabled={isLoading}
        className={`p-3 rounded-lg mb-2 ${
          isLoading ? 'bg-gray-400' : 'bg-green-500'
        }`}
      >
        <Text className="text-white text-center font-semibold">
          {isLoading ? 'Testing...' : 'Test Basic Connection'}
        </Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        onPress={testLoginEndpoint}
        disabled={isLoading}
        className={`p-3 rounded-lg ${
          isLoading ? 'bg-gray-400' : 'bg-blue-500'
        }`}
      >
        <Text className="text-white text-center font-semibold">
          {isLoading ? 'Testing...' : 'Test Login Endpoint'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
