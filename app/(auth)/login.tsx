import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const { currentTheme } = useTheme();
  const passwordInputRef = useRef<TextInput>(null);

  const isDark = currentTheme === 'dark';

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setIsLoading(true);
    try {
      console.log('Attempting login with:', { email, password: '***' });
      console.log('API Base URL:', 'http://192.168.100.25:8000/api');
      
      // Test network connectivity first
      try {
        const testResponse = await fetch('http://192.168.100.25:8000/api', {
          method: 'GET',
          timeout: 5000
        });
        console.log('Network test response:', testResponse.status);
      } catch (networkError) {
        console.error('Network test failed:', networkError);
        Alert.alert(
          'Network Error', 
          'Cannot connect to server. Please ensure your Laravel server is running with:\n\nphp artisan serve --host=0.0.0.0 --port=8000'
        );
        setIsLoading(false);
        return;
      }
      
      await login(email, password);
      console.log('Login successful!');
      router.replace('/');
    } catch (error: any) {
      console.error('Login error details:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        config: error.config
      });
      
      let errorMessage = 'An error occurred during login';
      
      if (error.message === 'Network Error') {
        errorMessage = 'Cannot connect to server. Please check:\n\n1. Laravel server is running\n2. Server is accessible from your device\n3. Run: php artisan serve --host=0.0.0.0 --port=8000';
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.data?.errors) {
        // Handle Laravel validation errors
        const errors = error.response.data.errors;
        const errorText = Object.keys(errors).map(key => 
          `${key}: ${errors[key].join(', ')}`
        ).join('\n');
        errorMessage = errorText;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      Alert.alert('Login Failed', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView 
      className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-white'}`}
      edges={['top']}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <ScrollView
          contentContainerStyle={{ 
            flexGrow: 1,
            paddingHorizontal: 24,
            paddingVertical: 40,
            paddingBottom: 100
          }}
          className={isDark ? 'bg-gray-900' : 'bg-white'}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          bounces={false}
        >
        <View className="w-full max-w-sm mx-auto" style={{ justifyContent: 'center', minHeight: '100%' }}>
          {/* App Icon and Name */}
          <View className="items-center mb-8">
            <Image
              source={require('@/assets/images/healtclassique-icon.png')}
              style={{ width: 80, height: 80, borderRadius: 20 }}
              resizeMode="cover"
            />
            <Text
              className={`text-2xl font-bold mt-4 mb-2 ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
            >
              TechChat
            </Text>
            <Text
              className={`text-center text-base ${
                isDark ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              Sign in to your account to continue
            </Text>
            <View className="mt-2 px-4 py-2 bg-secondary/10 rounded-lg">
              <Text className="text-secondary text-sm font-medium text-center">
                Welcome to TechChat
              </Text>
            </View>
          </View>

          {/* Form */}
          <View className="space-y-6">
            <View>
              <Text
                className={`text-sm font-semibold mb-3 ${
                  isDark ? 'text-gray-200' : 'text-gray-700'
                }`}
              >
                Email
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="next"
                onSubmitEditing={() => {
                  // Focus on password field when email is submitted
                  passwordInputRef.current?.focus();
                }}
                className={`w-full px-4 py-4 rounded-xl border-2 ${
                  isDark
                    ? 'bg-gray-800 border-gray-600 text-white focus:border-primary'
                    : 'bg-gray-50 border-gray-300 text-gray-900 focus:border-primary'
                }`}
                style={{ fontSize: 16 }}
              />
            </View>

            <View>
              <Text
                className={`text-sm font-semibold mb-3 ${
                  isDark ? 'text-gray-200' : 'text-gray-700'
                }`}
              >
                Password
              </Text>
              <View className="relative">
                <TextInput
                  ref={passwordInputRef}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  className={`w-full px-4 py-4 pr-12 rounded-xl border-2 ${
                    isDark
                      ? 'bg-gray-800 border-gray-600 text-white focus:border-primary'
                      : 'bg-gray-50 border-gray-300 text-gray-900 focus:border-primary'
                  }`}
                  style={{ fontSize: 16 }}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-0 bottom-0 justify-center"
                >
                  <MaterialCommunityIcons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={24}
                    color={isDark ? '#9CA3AF' : '#6B7280'}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              onPress={handleLogin}
              disabled={isLoading}
              className={`w-full py-4 rounded-xl mt-8 ${
                isLoading
                  ? 'bg-primary-light'
                  : 'bg-primary active:bg-primary-dark'
              }`}
              style={{ elevation: 2, shadowColor: '#283891', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4 }}
            >
              <Text className="text-white text-center font-bold text-lg">
                {isLoading ? 'Signing In...' : 'Sign In'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Sign Up Link - Hidden as requested */}
          {/* <View className="mt-8 flex-row justify-center">
            <Text
              className={`text-base ${
                isDark ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              Don't have an account?{' '}
            </Text>
            <Link href="/signup" asChild>
              <TouchableOpacity>
                <Text className="text-primary font-semibold text-base">
                  Sign Up
                </Text>
              </TouchableOpacity>
            </Link>
          </View> */}

          {/* Debug: Force Logout Button - Removed as requested */}
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
} 