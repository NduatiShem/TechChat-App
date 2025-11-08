import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useState } from 'react';
import {
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SignupScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { register } = useAuth();
  const { currentTheme } = useTheme();

  const isDark = currentTheme === 'dark';

  const handleSignup = async () => {
    if (!name || !email || !password || !passwordConfirmation) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (password !== passwordConfirmation) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters long');
      return;
    }

    setIsLoading(true);
    try {
      console.log('Attempting registration with:', { name, email, password: '***', password_confirmation: '***' });
      await register(name, email, '', password, passwordConfirmation);
      console.log('Registration successful!');
      // Wait for auth state to update, then navigate
      // expo-router automatically handles navigation based on auth state
      // No need to manually navigate here as AppLayout will handle it
    } catch (error: any) {
      console.error('Registration error details:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        config: error.config
      });
      
      let errorMessage = 'An error occurred during registration';
      
      if (error.response?.data?.message) {
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
      
      Alert.alert('Registration Failed', errorMessage);
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
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          className={isDark ? 'bg-gray-900' : 'bg-white'}
        >
        <View className="flex-1 justify-center px-6 py-12">
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
              Healthcare communication platform
            </Text>
            <View className="mt-2 px-4 py-2 bg-secondary/10 rounded-lg">
              <Text className="text-secondary text-sm font-medium text-center">
                Join our community
              </Text>
            </View>
          </View>

          {/* Header */}
          <View className="mb-8">
            <Text
              className={`text-2xl font-bold text-center mb-2 ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
            >
              Create Account
            </Text>
            <Text
              className={`text-center text-base ${
                isDark ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              Join TechChat and start messaging
            </Text>
          </View>

          {/* Form */}
          <View className="space-y-4">
            <View>
              <Text
                className={`text-sm font-medium mb-2 ${
                  isDark ? 'text-gray-200' : 'text-gray-700'
                }`}
              >
                Full Name
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Enter your full name"
                placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
                autoCapitalize="words"
                className={`w-full px-4 py-3 rounded-lg border ${
                  isDark
                    ? 'bg-gray-800 border-gray-600 text-white'
                    : 'bg-gray-50 border-gray-300 text-gray-900'
                }`}
              />
            </View>

            <View>
              <Text
                className={`text-sm font-medium mb-2 ${
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
                className={`w-full px-4 py-3 rounded-lg border ${
                  isDark
                    ? 'bg-gray-800 border-gray-600 text-white'
                    : 'bg-gray-50 border-gray-300 text-gray-900'
                }`}
              />
            </View>

            <View>
              <Text
                className={`text-sm font-medium mb-2 ${
                  isDark ? 'text-gray-200' : 'text-gray-700'
                }`}
              >
                Password
              </Text>
              <View className="relative">
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
                  secureTextEntry={!showPassword}
                  className={`w-full px-4 py-3 pr-12 rounded-lg border ${
                    isDark
                      ? 'bg-gray-800 border-gray-600 text-white'
                      : 'bg-gray-50 border-gray-300 text-gray-900'
                  }`}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-0 bottom-0 justify-center"
                >
                  <MaterialCommunityIcons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={24}
                    color={isDark ? '#9CA3AF' : '#6B7280'}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <View>
              <Text
                className={`text-sm font-medium mb-2 ${
                  isDark ? 'text-gray-200' : 'text-gray-700'
                }`}
              >
                Confirm Password
              </Text>
              <View className="relative">
                <TextInput
                  value={passwordConfirmation}
                  onChangeText={setPasswordConfirmation}
                  placeholder="Confirm your password"
                  placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
                  secureTextEntry={!showPasswordConfirmation}
                  className={`w-full px-4 py-3 pr-12 rounded-lg border ${
                    isDark
                      ? 'bg-gray-800 border-gray-600 text-white'
                      : 'bg-gray-50 border-gray-300 text-gray-900'
                  }`}
                />
                <TouchableOpacity
                  onPress={() => setShowPasswordConfirmation(!showPasswordConfirmation)}
                  className="absolute right-3 top-0 bottom-0 justify-center"
                >
                  <MaterialCommunityIcons
                    name={showPasswordConfirmation ? 'eye-off' : 'eye'}
                    size={24}
                    color={isDark ? '#9CA3AF' : '#6B7280'}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              onPress={handleSignup}
              disabled={isLoading}
              className={`w-full py-3 rounded-lg mt-6 ${
                isLoading
                  ? 'bg-primary-light'
                  : 'bg-primary'
              }`}
            >
              <Text className="text-white text-center font-semibold text-lg">
                {isLoading ? 'Creating Account...' : 'Create Account'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Sign In Link */}
          <View className="mt-8 flex-row justify-center">
            <Text
              className={`text-base ${
                isDark ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              Already have an account?{' '}
            </Text>
            <Link href="/login" asChild>
              <TouchableOpacity>
                <Text className="text-primary font-semibold text-base">
                  Sign In
                </Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
} 