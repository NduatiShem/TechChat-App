import { authAPI } from '@/services/api';
import { secureStorage } from '@/utils/secureStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface User {
  id: number;
  name: string;
  email: string;
  email_verified_at?: string;
  avatar_url?: string;
  is_admin?: boolean | number; // true/1 for admin, false/0 for regular user
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, phone: string, password: string, password_confirmation: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const USER_CACHE_KEY = '@techchat_user';

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Cache user data to AsyncStorage
  const cacheUser = async (userData: User) => {
    try {
      await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData));
    } catch (error) {
      console.error('Failed to cache user:', error);
    }
  };

  // Load cached user data from AsyncStorage
  const loadCachedUser = async (): Promise<User | null> => {
    try {
      const cachedData = await AsyncStorage.getItem(USER_CACHE_KEY);
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        if (parsed && parsed.id) {
          return parsed;
        }
      }
    } catch (error) {
      console.error('Failed to load cached user:', error);
    }
    return null;
  };

  const checkAuth = async () => {
    try {
      // Add small delay to ensure secureStorage is fully initialized
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const token = await secureStorage.getItem('auth_token');
      console.log('AuthContext: Checking auth, token exists:', !!token);
      
      // Validate token format (basic check - should be a non-empty string)
      if (token && typeof token === 'string' && token.trim().length > 0) {
        // First try to load from cache for instant display
        let cachedUser = await loadCachedUser();
        if (cachedUser) {
          setUser(cachedUser);
          setIsLoading(false);
        }

        try {
          // Add timeout protection for API call
          // Use a shorter timeout in production to fail faster
          const timeoutDuration = __DEV__ ? 10000 : 8000;
          const profilePromise = authAPI.getProfile();
          const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Profile fetch timeout')), timeoutDuration)
          );
          
          const response = await Promise.race([profilePromise, timeoutPromise]) as any;
          
          // Handle different response structures safely
          const userData = response.data?.data || response.data?.user || response.data;
          if (userData && userData.id) {
            setUser(userData);
            // Cache user data for offline access
            await cacheUser(userData);
          } else {
            console.warn('AuthContext: No user data in response');
            // Don't clear token immediately - might be network issue
            // Only clear if it's a 401 error
            // Keep cached user if available
            if (!cachedUser) {
              setUser(null);
            }
          }
        } catch (profileError: any) {
          // If profile fetch fails, check error type
          const errorMessage = profileError?.message || String(profileError);
          const statusCode = profileError?.response?.status;
          const errorData = profileError?.response?.data;
          
          // Log detailed error in development
          if (__DEV__) {
            console.error('AuthContext: Profile fetch failed:', {
              message: errorMessage,
              status: statusCode,
              errorData: errorData,
              url: profileError?.config?.url,
              baseURL: profileError?.config?.baseURL,
            });
          }
          
          // Handle different error status codes
          if (statusCode === 401 || statusCode === 403) {
            // Unauthorized/Forbidden - token is invalid, clear it
            try {
              await secureStorage.deleteItem('auth_token');
              // Clear cached user data
              await AsyncStorage.removeItem(USER_CACHE_KEY);
              console.log('AuthContext: Token cleared due to', statusCode, 'error - user needs to login again');
            } catch (deleteError) {
              console.error('AuthContext: Failed to delete token:', deleteError);
            }
            setUser(null);
            setIsLoading(false); // Ensure loading is set to false so login screen can show
          } else {
            // Server error, network error, timeout, or other errors
            // Don't clear token - might be temporary server issue or offline
            // Keep cached user if available (already loaded at the start)
            if (!cachedUser) {
              // Try to load from cache one more time
              cachedUser = await loadCachedUser();
              if (cachedUser) {
                setUser(cachedUser);
              } else {
                setUser(null);
              }
            }
            if (__DEV__) {
              console.warn('AuthContext: Profile fetch failed (status:', statusCode, ') - keeping token and cached user');
            }
          }
        }
      } else {
        console.log('AuthContext: No token found, user not authenticated');
      }
    } catch (error: any) {
      // Catch any unexpected errors and prevent app crash
      console.error('AuthContext: Auth check failed:', error?.message || error);
      // Don't crash - just set loading to false and user to null
      try {
        // Only try to delete token if we can access secureStorage
        const token = await secureStorage.getItem('auth_token');
        if (token) {
          // If there was an error and we have a token, it might be invalid
          // But don't clear it on unexpected errors - might be storage issue
          console.warn('AuthContext: Unexpected error with token present - keeping token');
        }
      } catch (storageError) {
        console.error('AuthContext: Cannot access secureStorage:', storageError);
      }
      setUser(null);
    } finally {
      // Always set loading to false, even if there was an error
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      console.log('AuthContext: Starting login...');
      const response = await authAPI.login(email, password);
      console.log('AuthContext: Login response:', response.data);
      
      // Handle the response structure - it's directly in response.data, not response.data.data
      const { user: userData, token } = response.data;
      
      // Ensure token is a string
      if (!token || typeof token !== 'string') {
        throw new Error('Invalid token received from server');
      }
      
      console.log('AuthContext: Setting token and user...');
      await secureStorage.setItem('auth_token', token);
      setUser(userData);
      // Cache user data for offline access
      await cacheUser(userData);
      console.log('AuthContext: Login completed successfully');
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const register = async (name: string, email: string, phone: string, password: string, password_confirmation: string) => {
    try {
      console.log('AuthContext: Starting registration...');
      const response = await authAPI.register(name, email, phone, password, password_confirmation);
      console.log('AuthContext: Registration response:', response.data);
      
      // Handle the response structure - it's directly in response.data, not response.data.data
      const { user: userData, token } = response.data;
      
      // Ensure token is a string
      if (!token || typeof token !== 'string') {
        throw new Error('Invalid token received from server');
      }
      
      console.log('AuthContext: Setting token and user...');
      await secureStorage.setItem('auth_token', token);
      setUser(userData);
      // Cache user data for offline access
      await cacheUser(userData);
      console.log('AuthContext: Registration completed successfully');
    } catch (error) {
      console.error('AuthContext: Registration failed:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      // Try to call the logout API, but don't fail if it doesn't work
      await authAPI.logout();
    } catch (error) {
      console.error('Logout API call failed:', error);
      // Don't throw the error - we still want to logout locally
    } finally {
      // Always clear local auth state regardless of API call success
      await secureStorage.deleteItem('auth_token');
      // Clear cached user data
      try {
        await AsyncStorage.removeItem(USER_CACHE_KEY);
      } catch (error) {
        console.error('Failed to clear cached user:', error);
      }
      setUser(null);
      // Don't navigate here - let the AppLayout handle the navigation
      // The AppLayout will automatically show the auth screens when isAuthenticated becomes false
    }
  };

  const refreshUser = async () => {
    try {
      const token = await secureStorage.getItem('auth_token');
      if (token) {
        const response = await authAPI.getProfile();
        const userData = response.data?.data || response.data?.user || response.data;
        if (userData && userData.id) {
          setUser(userData);
          // Cache user data for offline access
          await cacheUser(userData);
        } else {
          console.warn('RefreshUser: No user data returned, keeping existing user');
        }
      }
    } catch (error) {
      console.error('Failed to refresh user data:', error);
      // Do not force logout on refresh failures - keep existing user state
      // Try to load from cache if refresh fails
      const cachedUser = await loadCachedUser();
      if (cachedUser) {
        setUser(cachedUser);
      }
    }
  };

  useEffect(() => {
    // Wrap in try-catch to prevent crashes during initialization
    let mounted = true;
    let timeoutId: NodeJS.Timeout | null = null;
    
    const initializeAuth = async () => {
      // Set a fallback timeout to ensure loading is always set to false
      // This prevents the app from getting stuck on loading screen
      timeoutId = setTimeout(() => {
        if (mounted) {
          console.warn('AuthContext: Initialization timeout - forcing loading to false');
          setIsLoading(false);
        }
      }, 15000); // 15 second maximum timeout
      
      try {
        await checkAuth();
        // If checkAuth completes successfully, clear the timeout
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      } catch (error) {
        console.error('AuthContext: Initialization error:', error);
        // Clear timeout since we're handling the error
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        // Ensure loading is set to false even on error
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    
    initializeAuth();
    
    return () => {
      mounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    checkAuth,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}; 