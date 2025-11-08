import { AppConfig } from '@/config/app.config';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
    Alert,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  
  // Use refs to persist error state across re-renders
  const emailErrorRef = useRef('');
  const passwordErrorRef = useRef('');
  const showErrorRef = useRef(false);
  const errorMessageRef = useRef('');
  
  const { login } = useAuth();
  const { currentTheme } = useTheme();
  const passwordInputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const isDark = currentTheme === 'dark';

  // Track keyboard height
  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Helper function to get base URL
  const getBaseUrl = () => {
    if (__DEV__) {
      if (Platform.OS === 'ios') {
        return AppConfig.api.development.ios;
      } else if (Platform.OS === 'android') {
        // Use physical device URL for Android (includes Expo Go on physical devices)
        return AppConfig.api.development.physical;
      } else {
        return AppConfig.api.development.physical;
      }
    }
    return AppConfig.api.production;
  };

  // Restore error state from refs if component re-renders
  useEffect(() => {
    if (passwordErrorRef.current && !passwordError) {
      setPasswordError(passwordErrorRef.current);
    }
    if (emailErrorRef.current && !emailError) {
      setEmailError(emailErrorRef.current);
    }
    if (showErrorRef.current && !showError) {
      setShowError(showErrorRef.current);
    }
    if (errorMessageRef.current && !errorMessage) {
      setErrorMessage(errorMessageRef.current);
    }
  }, [emailError, passwordError, showError, errorMessage]);

  const handleLogin = async () => {
    // Clear previous errors
    setEmailError('');
    setPasswordError('');
    setShowError(false);
    setErrorMessage('');
    emailErrorRef.current = '';
    passwordErrorRef.current = '';
    showErrorRef.current = false;
    errorMessageRef.current = '';
    
    if (!email || !password) {
      if (!email) setEmailError('Email is required');
      if (!password) setPasswordError('Password is required');
      return;
    }

    setIsLoading(true);
    try {
      // Test network connectivity first
      try {
        await fetch(getBaseUrl(), {
          method: 'GET',
        });
      } catch {
        Alert.alert(
          'Network Error', 
          'Cannot connect to server. Please ensure your Laravel server is running with:\n\nphp artisan serve --host=0.0.0.0 --port=8000'
        );
        setIsLoading(false);
        return;
      }
      
      await login(email, password);
      // Wait for auth state to update, then navigate
      // expo-router automatically handles navigation based on auth state
      // No need to manually navigate here as AppLayout will handle it
    } catch (error: any) {
      // Handle different error types with field-specific validation
      if (error.response?.status === 403 && error.response?.data?.account_deactivated) {
        // Account deactivated
        const errorMessage = error.response?.data?.message || 'Your account has been deactivated. Please contact an administrator.';
        setShowError(true);
        setErrorMessage(errorMessage);
        showErrorRef.current = true;
        errorMessageRef.current = errorMessage;
        setPassword(''); // Clear password
      } else if (error.response?.status === 401) {
        // Unauthorized - could be wrong email or password
        // For 401 errors, show persistent error message
        const errorMsg = 'Wrong credentials. Please check your email and password.';
        setShowError(true);
        setErrorMessage(errorMsg);
        showErrorRef.current = true;
        errorMessageRef.current = errorMsg;
        setPassword(''); // Clear password for retry
      } else if (error.response?.data?.errors) {
        // Handle Laravel validation errors
        const errors = error.response.data.errors;
        if (errors.email) {
          setEmailError(errors.email[0]);
        }
        if (errors.password) {
          setPasswordError(errors.password[0]);
        }
      } else if (error.message === 'Network Error') {
        Alert.alert(
          'Network Error', 
          'Cannot connect to server. Please check:\n\n1. Laravel server is running\n2. Server is accessible from your device\n3. Run: php artisan serve --host=0.0.0.0 --port=8000'
        );
      } else {
        // Generic error - show alert for unexpected errors
        Alert.alert('Login Failed', error.message || 'An unexpected error occurred');
      }
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
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={{ 
            flexGrow: 1,
            paddingHorizontal: 24,
            paddingVertical: 40,
            paddingBottom: Platform.OS === 'android'
              ? (keyboardHeight > 0 ? Math.max(keyboardHeight - 100, 20) : Math.max(insets.bottom + 20, 40))
              : Math.max(insets.bottom + 20, keyboardHeight > 0 ? 20 : 40)
          }}
          className={isDark ? 'bg-gray-900' : 'bg-white'}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'android'}
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

              {/* Persistent Error Message */}
              {showError && (
                <View className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
                  <Text className="text-red-600 text-sm text-center font-medium">
                    {errorMessage}
                  </Text>
                </View>
              )}

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
                onChangeText={(text) => {
                  setEmail(text);
                  // Don't clear error immediately - let user see the error
                }}
                placeholder="Enter your email"
                placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="next"
                onFocus={() => {
                  if (emailError) {
                    setEmailError(''); // Clear error when user focuses on email
                    emailErrorRef.current = '';
                  }
                  if (showError) {
                    setShowError(false); // Clear persistent error when user focuses
                    showErrorRef.current = false;
                    setErrorMessage('');
                    errorMessageRef.current = '';
                  }
                }}
                onSubmitEditing={() => {
                  // Focus on password field when email is submitted
                  passwordInputRef.current?.focus();
                }}
                className={`w-full px-4 py-4 rounded-xl border-2 ${
                  emailError
                    ? 'border-red-500 bg-red-50'
                    : isDark
                    ? 'bg-gray-800 border-gray-600 text-white focus:border-primary'
                    : 'bg-gray-50 border-gray-300 text-gray-900 focus:border-primary'
                }`}
                style={{ 
                  fontSize: 16,
                  color: emailError ? '#DC2626' : (isDark ? '#FFFFFF' : '#111827')
                }}
              />
              {emailError ? (
                <Text className="text-red-500 text-sm mt-2 ml-1">
                  {emailError}
                </Text>
              ) : null}
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
                  onChangeText={(text) => {
                    setPassword(text);
                    // Don't clear error immediately - let user see the error
                  }}
                  placeholder="Enter your password"
                  placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onFocus={() => {
                    if (passwordError) {
                      setPasswordError(''); // Clear error when user focuses on password
                      passwordErrorRef.current = '';
                    }
                    if (showError) {
                      setShowError(false); // Clear persistent error when user focuses
                      showErrorRef.current = false;
                      setErrorMessage('');
                      errorMessageRef.current = '';
                    }
                  }}
                  onSubmitEditing={handleLogin}
                  className={`w-full px-4 py-4 pr-12 rounded-xl border-2 ${
                    passwordError
                      ? 'border-red-500 bg-red-50'
                      : isDark
                      ? 'bg-gray-800 border-gray-600 text-white focus:border-primary'
                      : 'bg-gray-50 border-gray-300 text-gray-900 focus:border-primary'
                  }`}
                  style={{ 
                    fontSize: 16,
                    color: passwordError ? '#DC2626' : (isDark ? '#FFFFFF' : '#111827')
                  }}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-0 bottom-0 justify-center"
                >
                  <MaterialCommunityIcons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={24}
                    color={passwordError ? '#DC2626' : (isDark ? '#9CA3AF' : '#6B7280')}
                  />
                </TouchableOpacity>
              </View>
              {passwordError ? (
                <Text className="text-red-500 text-sm mt-2 ml-1">
                  {passwordError}
                </Text>
              ) : null}
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
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
    </SafeAreaView>
  );
} 