import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import ApiTest from '@/components/ApiTest';

export default function ApiTestScreen() {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === 'dark';

  return (
    <SafeAreaView className={`flex-1 $[object Object]isDark ?bg-gray-90 : 'bg-white'}`}>
      <ApiTest />
    </SafeAreaView>
  );
} 