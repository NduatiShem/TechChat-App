import { authAPI } from '@/services/api';
import { secureStorage } from '@/utils/secureStore';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface User {
  id: number;
  name: string;
  email: string;
  email_verified_at?: string;
  avatar_url?: string;
  is_admin?: boolean; // 1 for admin, 0 for regular user
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, password_confirmation: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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

  const checkAuth = async () => {
    try {
      // Add small delay to ensure secureStorage is fully initialized
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const token = await secureStorage.getItem('auth_token');
      console.log('AuthContext: Checking auth, token exists:', !!token);
      
      if (token) {
        try {
          // Add timeout protection for API call
          const profilePromise = authAPI.getProfile();
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Profile fetch timeout')), 10000)
          );
          
          const response = await Promise.race([profilePromise, timeoutPromise]) as any;
          
          console.log('AuthContext: Profile response:', response.data);
          // Handle different response structures safely
          const userData = response.data?.data || response.data?.user || response.data;
          if (userData && userData.id) {
            setUser(userData);
            console.log('AuthContext: User set successfully');
          } else {
            console.warn('AuthContext: No user data in response');
            // Don't clear token immediately - might be network issue
            // Only clear if it's a 401 error
            setUser(null);
          }
        } catch (profileError: any) {
          // If profile fetch fails, check error type
          const errorMessage = profileError?.message || String(profileError);
          const statusCode = profileError?.response?.status;
          
          console.error('AuthContext: Profile fetch failed:', errorMessage);
          
          // Only clear token if it's a 401 (unauthorized) or 403 (forbidden)
          // Network errors shouldn't clear the token
          if (statusCode === 401 || statusCode === 403) {
            try {
              await secureStorage.deleteItem('auth_token');
            } catch (deleteError) {
              console.error('AuthContext: Failed to delete token:', deleteError);
            }
            setUser(null);
          } else if (statusCode === undefined) {
            // Network error or timeout - don't clear token, just set user to null
            console.warn('AuthContext: Network error - keeping token for retry');
            setUser(null);
          } else {
            // Other errors - clear token to be safe
            try {
              await secureStorage.deleteItem('auth_token');
            } catch (deleteError) {
              console.error('AuthContext: Failed to delete token:', deleteError);
            }
            setUser(null);
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
      console.log('AuthContext: Login completed successfully');
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const register = async (name: string, email: string, password: string, password_confirmation: string) => {
    try {
      console.log('AuthContext: Starting registration...');
      const response = await authAPI.register(name, email, password, password_confirmation);
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
        setUser(response.data.data);
      }
    } catch (error) {
      console.error('Failed to refresh user data:', error);
    }
  };

  useEffect(() => {
    // Wrap in try-catch to prevent crashes during initialization
    let mounted = true;
    
    const initializeAuth = async () => {
      try {
        await checkAuth();
      } catch (error) {
        console.error('AuthContext: Initialization error:', error);
        // Ensure loading is set to false even on error
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    
    initializeAuth();
    
    return () => {
      mounted = false;
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