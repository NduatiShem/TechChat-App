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
  // CRITICAL: Start with isLoading = false to prevent stuck loading screen
  // We'll set it to true only when we're actively checking auth
  // This ensures the app shows immediately, even on reload
  const [isLoading, setIsLoading] = useState(false);

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
      // Add timeout protection for AsyncStorage in builds
      const cachePromise = AsyncStorage.getItem(USER_CACHE_KEY);
      const cacheTimeout = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Cache load timeout')), 2000)
      );
      
      const cachedData = await Promise.race([cachePromise, cacheTimeout]) as string | null;
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        if (parsed && parsed.id) {
          return parsed;
        }
      }
    } catch (error) {
      console.warn('Failed to load cached user (may be timeout):', error);
      // Return null on error - app will continue without cached user
    }
    return null;
  };

  const checkAuth = async () => {
    // CRITICAL: Set multiple safety timeouts to ensure isLoading is ALWAYS set to false
    // This prevents the app from getting stuck on loading screen
    const safetyTimeout1 = setTimeout(() => {
      console.warn('AuthContext: checkAuth safety timeout 1 - forcing loading to false');
      setIsLoading(false);
    }, 2000); // 2 seconds max for the entire checkAuth operation
    
    const safetyTimeout2 = setTimeout(() => {
      console.warn('AuthContext: checkAuth safety timeout 2 - forcing loading to false');
      setIsLoading(false);
    }, 3000); // 3 seconds backup
    
    try {
      // Add small delay to ensure secureStorage is fully initialized
      // Use a timeout to prevent hanging in builds
      const initPromise = new Promise(resolve => setTimeout(resolve, 50));
      const initTimeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('SecureStore initialization timeout')), 1500)
      );
      
      try {
        await Promise.race([initPromise, initTimeoutPromise]);
      } catch (timeoutError) {
        console.warn('AuthContext: SecureStore initialization timeout, continuing anyway');
      }
      
      // Get token with timeout protection - shorter timeout for builds
      let token: string | null = null;
      try {
        const tokenPromise = secureStorage.getItem('auth_token');
        const tokenTimeout = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Token fetch timeout')), 2000)
        );
        token = await Promise.race([tokenPromise, tokenTimeout]) as string | null;
      } catch (tokenError) {
        console.warn('AuthContext: Token fetch failed or timed out:', tokenError);
        // Continue without token - user will need to login
        token = null;
      }
      
      console.log('AuthContext: Checking auth, token exists:', !!token);
      
      // Validate token format (basic check - should be a non-empty string)
      if (token && typeof token === 'string' && token.trim().length > 0) {
        // First try to load from cache for instant display
        let cachedUser: User | null = null;
        try {
          cachedUser = await loadCachedUser();
          if (cachedUser) {
            setUser(cachedUser);
            setIsLoading(false); // Show app immediately with cached user
          }
        } catch (cacheError) {
          console.warn('AuthContext: Failed to load cached user:', cacheError);
        }

        try {
          // Add timeout protection for API call
          // Use a shorter timeout in builds to fail faster
          const timeoutDuration = __DEV__ ? 8000 : 5000;
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
              try {
                cachedUser = await loadCachedUser();
                if (cachedUser) {
                  setUser(cachedUser);
                } else {
                  setUser(null);
                }
              } catch (cacheError2) {
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
      // Clear safety timeouts since we're done
      clearTimeout(safetyTimeout1);
      clearTimeout(safetyTimeout2);
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
    let forceTimeoutId: NodeJS.Timeout | null = null;
    let immediateTimeoutId: NodeJS.Timeout | null = null;
    let ultraFastTimeoutId: NodeJS.Timeout | null = null;
    
    // CRITICAL: Only load from cache if we have a valid token
    // This prevents showing cached user when token is invalid/missing
    const loadFromCacheFirst = async () => {
      try {
        // First check if token exists
        const token = await secureStorage.getItem('auth_token');
        if (!token || typeof token !== 'string' || token.trim().length === 0) {
          // No token - clear cache and don't show cached user
          console.log('AuthContext: No token found, clearing cache');
          try {
            await AsyncStorage.removeItem(USER_CACHE_KEY);
            if (mounted) {
              setUser(null);
            }
          } catch (clearError) {
            console.warn('AuthContext: Failed to clear cache:', clearError);
          }
          return;
        }
        
        // Token exists - load cached user for instant display
        const cachedUser = await loadCachedUser();
        if (cachedUser && mounted) {
          console.log('AuthContext: Loaded user from cache (token exists)');
          setUser(cachedUser);
          // Don't set isLoading to true - keep it false so app shows immediately
        }
      } catch (error) {
        console.warn('AuthContext: Failed to load from cache:', error);
      }
    };
    
    // Load from cache immediately (non-blocking)
    loadFromCacheFirst();
    
    // CRITICAL: Set multiple aggressive timeouts to ensure loading is ALWAYS false
    // These are the last line of defense against stuck loading screens
    // Ultra-fast timeout: 1 second (for reload scenarios)
    ultraFastTimeoutId = setTimeout(() => {
      if (mounted) {
        console.warn('AuthContext: ULTRA-FAST timeout - forcing loading to false (reload safety)');
        setIsLoading(false);
      }
    }, 1000); // 1 second - very aggressive for reloads
    
    // Immediate timeout: 2 seconds
    immediateTimeoutId = setTimeout(() => {
      if (mounted) {
        console.warn('AuthContext: IMMEDIATE timeout - forcing loading to false (critical safety)');
        setIsLoading(false);
      }
    }, 2000); // 2 seconds max - very aggressive
    
    const initializeAuth = async () => {
      // Set a fallback timeout to ensure loading is always set to false
      // This prevents the app from getting stuck on loading screen
      // Use shorter timeout for builds (3 seconds) vs dev (5 seconds)
      const maxTimeout = __DEV__ ? 5000 : 3000;
      
      timeoutId = setTimeout(() => {
        if (mounted) {
          console.warn('AuthContext: Initialization timeout - forcing loading to false');
          setIsLoading(false);
        }
      }, maxTimeout);
      
      // Additional aggressive timeout for builds - force loading to false after 2.5 seconds
      if (!__DEV__) {
        forceTimeoutId = setTimeout(() => {
          if (mounted) {
            console.warn('AuthContext: Force timeout - setting loading to false (build safety)');
            setIsLoading(false);
          }
        }, 2500);
      }
      
      try {
        // Only set loading to true when we actually start checking auth
        // This way, if checkAuth hangs, we've already shown the app
        setIsLoading(true);
        
        // Wrap checkAuth in a timeout to prevent hanging
        const checkAuthPromise = checkAuth();
        const checkAuthTimeout = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('checkAuth timeout')), maxTimeout - 500)
        );
        
        await Promise.race([checkAuthPromise, checkAuthTimeout]);
        
        // If checkAuth completes successfully, clear the timeouts
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (forceTimeoutId) {
          clearTimeout(forceTimeoutId);
          forceTimeoutId = null;
        }
        if (immediateTimeoutId) {
          clearTimeout(immediateTimeoutId);
          immediateTimeoutId = null;
        }
        if (ultraFastTimeoutId) {
          clearTimeout(ultraFastTimeoutId);
          ultraFastTimeoutId = null;
        }
      } catch (error) {
        console.error('AuthContext: Initialization error:', error);
        // Clear timeouts since we're handling the error
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (forceTimeoutId) {
          clearTimeout(forceTimeoutId);
          forceTimeoutId = null;
        }
        if (immediateTimeoutId) {
          clearTimeout(immediateTimeoutId);
          immediateTimeoutId = null;
        }
        if (ultraFastTimeoutId) {
          clearTimeout(ultraFastTimeoutId);
          ultraFastTimeoutId = null;
        }
        // Ensure loading is set to false even on error
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    
    // Small delay before starting auth check to allow cache to load first
    setTimeout(() => {
      initializeAuth();
    }, 100);
    
    return () => {
      mounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (forceTimeoutId) {
        clearTimeout(forceTimeoutId);
      }
      if (immediateTimeoutId) {
        clearTimeout(immediateTimeoutId);
      }
      if (ultraFastTimeoutId) {
        clearTimeout(ultraFastTimeoutId);
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