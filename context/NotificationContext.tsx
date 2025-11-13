import { authAPI } from '@/services/api';
import { badgeService } from '@/services/badgeService';
import { notificationService } from '@/services/notificationService';
import { useAuth } from '@/context/AuthContext';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';

interface NotificationContextType {
  unreadCount: number;
  groupUnreadCount: number; // Total unread count for groups only
  conversationCounts: Record<number, number>;
  expoPushToken: string | null;
  devicePushToken: string | null;
  updateUnreadCount: (conversationId: number, count: number) => void;
  updateGroupUnreadCount: (totalCount: number) => void; // Update total group unread count
  resetUnreadCount: (conversationId: number) => void;
  resetAllCounts: () => void;
  checkPermissionStatus: () => Promise<{ granted: boolean; status: string }>;
  requestPermissions: () => Promise<boolean>;
  getDiagnostics: () => Promise<{
    deviceInfo: any;
    permissionStatus: any;
    projectId: string | null;
    appOwnership: string;
    isExpoGo: boolean;
    errors: string[];
  }>;
  scheduleLocalNotification: (title: string, body: string, data?: any) => Promise<void>;
  showForegroundNotification: (title: string, body: string, data?: any) => Promise<void>;
  getExpoPushToken: () => Promise<string | null>;
  triggerPushTokenRegistration: (options?: {
    forceRefresh?: boolean;
  }) => Promise<{
    success: boolean;
    message: string;
    expoToken: string | null;
    deviceToken: string | null;
  }>;
  verifyAndSyncFcmToken: () => Promise<boolean>;
  setActiveConversation: (conversationId: number | null) => void;
  clearActiveConversation: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    console.log('Notification handler called:', notification);
    
    // Always show notifications, even when app is in foreground
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

interface NotificationProviderProps {
  children: ReactNode;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [groupUnreadCount, setGroupUnreadCount] = useState(0); // Total unread count for groups only
  const [conversationCounts, setConversationCounts] = useState<Record<number, number>>({});
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [devicePushToken, setDevicePushToken] = useState<string | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [isRegisteringToken, setIsRegisteringToken] = useState(false);
  const [lastRegisteredToken, setLastRegisteredToken] = useState<string | null>(null);
  const [lastRegistrationTime, setLastRegistrationTime] = useState<number>(0);
  const [lastVerificationTime, setLastVerificationTime] = useState<number>(0);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const registrationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const periodicCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const notifiedMessageIdsRef = useRef<Set<number>>(new Set());

  const updateUnreadCount = (conversationId: number, count: number) => {
    setConversationCounts(prev => {
      const newCounts = { ...prev, [conversationId]: count };
      const total = Object.values(newCounts).reduce((sum, count) => sum + count, 0);
      setUnreadCount(total);
      
      // Update app badge
      updateAppBadge(total);
      
      return newCounts;
    });
  };

  const resetUnreadCount = (conversationId: number) => {
    setConversationCounts(prev => {
      const newCounts = { ...prev };
      delete newCounts[conversationId];
      const total = Object.values(newCounts).reduce((sum, count) => sum + count, 0);
      setUnreadCount(total);
      
      // Update app badge
      updateAppBadge(total);
      
      return newCounts;
    });
  };

  const updateGroupUnreadCount = (totalCount: number) => {
    setGroupUnreadCount(totalCount);
  };

  const resetAllCounts = () => {
    setConversationCounts({});
    setUnreadCount(0);
    setGroupUnreadCount(0);
    
    // Clear app badge
    updateAppBadge(0);
  };

  const getExpoPushToken = async (): Promise<string | null> => {
    try {
      console.log('🔍 [DIAGNOSTIC] Starting token generation...');
      
      // Device check
      const isPhysicalDevice = Device.isDevice;
      console.log('🔍 [DIAGNOSTIC] Is physical device:', isPhysicalDevice);
      if (!isPhysicalDevice) {
        console.log('❌ Must use physical device for Push Notifications');
        return null;
      }

      // Check app ownership (Expo Go vs development build)
      const appOwnership = Constants.appOwnership;
      const isExpoGo = appOwnership === 'expo';
      console.log('🔍 [DIAGNOSTIC] App ownership:', appOwnership, '| Is Expo Go:', isExpoGo);
      
      if (isExpoGo) {
        console.warn('⚠️ Push notifications are not supported in Expo Go with SDK 53+. Please use a development build instead.');
        console.log('💡 To fix this:');
        console.log('   1. Run: npx eas build --profile development --platform android');
        console.log('   2. Install the development build on your device');
        console.log('   3. Use the development build instead of Expo Go');
        return null;
      }

      // Check permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      console.log('🔍 [DIAGNOSTIC] Current permission status:', existingStatus);
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        console.log('🔍 [DIAGNOSTIC] Requesting permissions...');
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
        console.log('🔍 [DIAGNOSTIC] Permission request result:', status);
      }
      
      if (finalStatus !== 'granted') {
        console.log('❌ Failed to get push token - permissions not granted. Status:', finalStatus);
        return null;
      }

      // Get project ID from app.json configuration
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      console.log('🔍 [DIAGNOSTIC] Project ID:', projectId ? 'Found' : 'MISSING', projectId);
      if (!projectId) {
        console.error('❌ Project ID not found in app.json configuration');
        return null;
      }

      // Get Expo push token with detailed error handling
      let token;
      let expoTokenError: any = null;
      try {
        console.log('🔍 [DIAGNOSTIC] Attempting to get Expo push token...');
        token = await Notifications.getExpoPushTokenAsync({
          projectId: projectId,
        });
        console.log('🔍 [DIAGNOSTIC] Expo push token result:', token ? 'Success' : 'Failed', token?.data ? `Token: ${token.data.substring(0, 20)}...` : 'No data');
      } catch (error: any) {
        expoTokenError = error;
        const errorMessage = error?.message || String(error);
        const errorCode = error?.code;
        const errorStack = error?.stack;
        
        console.error('❌ [DIAGNOSTIC] Expo push token error details:');
        console.error('   Message:', errorMessage);
        console.error('   Code:', errorCode);
        console.error('   Full error:', error);
        
        // Handle SERVICE_NOT_AVAILABLE (Google Play Services issue)
        if (errorMessage.includes('SERVICE_NOT_AVAILABLE') || 
            errorMessage.includes('ExecutionException') ||
            errorMessage.includes('IOException')) {
          console.error('❌ Google Play Services is not available on this device.');
          console.error('💡 This is a device-specific issue. Possible causes:');
          console.error('   1. Google Play Services is not installed or outdated');
          console.error('   2. Google Play Services is disabled in device settings');
          console.error('   3. Device doesn\'t have Google Play Services (some Chinese phones, custom ROMs)');
          console.error('   4. Network connectivity issues preventing access to Google services');
          console.error('   5. Google account not properly set up on the device');
          console.error('');
          console.error('🔧 Solutions:');
          console.error('   • Update Google Play Services: Settings → Apps → Google Play Services → Update');
          console.error('   • Enable Google Play Services: Settings → Apps → Google Play Services → Enable');
          console.error('   • Check internet connection and try again');
          console.error('   • Add/verify Google account: Settings → Accounts → Add account');
          console.error('   • If using a device without Google Play Services, push notifications may not work');
          return null;
        }
        
        // Handle Firebase/FCM initialization errors gracefully
        if (errorMessage.includes('FirebaseApp') || 
            errorMessage.includes('FCM') || 
            errorMessage.includes('Firebase') ||
            errorMessage.includes('google-services.json') ||
            errorMessage.includes('GoogleService')) {
          console.warn('⚠️ Firebase/FCM not configured. Push notifications may not work.');
          console.warn('💡 To enable push notifications:');
          console.warn('   1. Follow: https://docs.expo.dev/push-notifications/fcm-credentials/');
          console.warn('   2. Upload google-services.json to Expo using: eas credentials');
          console.warn('   3. Rebuild the app');
          // Store error for diagnostic purposes
          return null;
        }
        // Log other errors but don't crash
        console.error('❌ Error getting Expo push token:', error);
        return null;
      }
      
      if (token?.data) {
        console.log('✅ Expo Push Token generated:', token.data);
        setExpoPushToken(token.data);
      } else {
        console.warn('⚠️ Expo push token returned but no data field');
      }

      // Attempt to get the native device push token (FCM/APNs)
      let deviceTokenError: any = null;
      try {
        console.log('🔍 [DIAGNOSTIC] Attempting to get device push token (FCM/APNs)...');
        const deviceTokenResult = await Notifications.getDevicePushTokenAsync();
        console.log('🔍 [DIAGNOSTIC] Device push token result:', deviceTokenResult ? 'Success' : 'Failed');
        console.log('🔍 [DIAGNOSTIC] Device token type:', deviceTokenResult?.type);
        console.log('🔍 [DIAGNOSTIC] Device token data:', deviceTokenResult?.data ? `${deviceTokenResult.data.substring(0, 20)}...` : 'No data');
        
        if (deviceTokenResult?.data) {
          console.log(`✅ Device push token (${deviceTokenResult.type}) generated:`, deviceTokenResult.data);
          setDevicePushToken(deviceTokenResult.data);
        } else {
          console.warn('⚠️ Device push token not available yet');
        }
      } catch (error: any) {
        deviceTokenError = error;
        const errorMessage = error?.message || String(error);
        const errorCode = error?.code;
        
        console.error('❌ [DIAGNOSTIC] Device push token error details:');
        console.error('   Message:', errorMessage);
        console.error('   Code:', errorCode);
        console.error('   Full error:', error);
        
        // Handle SERVICE_NOT_AVAILABLE (Google Play Services issue)
        if (errorMessage.includes('SERVICE_NOT_AVAILABLE') || 
            errorMessage.includes('ExecutionException') ||
            errorMessage.includes('IOException')) {
          console.error('❌ Google Play Services is not available on this device.');
          console.error('💡 This is a device-specific issue. See Expo token error above for solutions.');
        }
        
        // Check for Firebase/FCM errors
        if (errorMessage.includes('FirebaseApp') || 
            errorMessage.includes('FCM') || 
            errorMessage.includes('Firebase') ||
            errorMessage.includes('google-services.json')) {
          console.warn('⚠️ Firebase/FCM not configured for device token generation.');
        }
      }

      return token?.data ?? null;
    } catch (error) {
      console.error('❌ [DIAGNOSTIC] Unexpected error in getExpoPushToken:', error);
      return null;
    }
  };

  // Check if token exists in database before registering
  const checkTokenInDatabase = useCallback(async (): Promise<{ exists: boolean; matches: boolean; savedToken: string | null }> => {
    try {
      const response = await authAPI.getProfile();
      const userData = response.data?.data || response.data?.user || response.data;
      
      if (!userData) {
        return { exists: false, matches: false, savedToken: null };
      }

      const savedToken = userData.fcm_token || null;
      const currentToken = devicePushToken || expoPushToken;
      
      return {
        exists: !!savedToken,
        matches: savedToken === currentToken,
        savedToken: savedToken,
      };
    } catch (error) {
      console.error('Error checking token in database:', error);
      return { exists: false, matches: false, savedToken: null };
    }
  }, [devicePushToken, expoPushToken]);

  const registerPushTokenWithBackend = useCallback(
    async (reason: string, force: boolean = false) => {
      if (!isAuthenticated) {
        console.log(`🔒 Skipping push token registration (${reason}) - user not authenticated`);
        return false;
      }

      const tokenToRegister = devicePushToken || expoPushToken;
      if (!tokenToRegister) {
        console.log(`⏳ Push token not yet available (${reason})`);
        return false;
      }

      if (isRegisteringToken) {
        console.log(`⏰ Token registration already in progress (${reason})`);
        return false;
      }

      // Check if token is already registered locally (unless forced)
      if (!force && lastRegisteredToken === tokenToRegister) {
        console.log(`✅ Push token already registered locally (${reason})`);
        // Still verify in database periodically
        const now = Date.now();
        const timeSinceLastVerification = now - lastVerificationTime;
        const VERIFICATION_INTERVAL = 300000; // 5 minutes
        
        if (timeSinceLastVerification >= VERIFICATION_INTERVAL) {
          // Check database to ensure it's still there
          const dbCheck = await checkTokenInDatabase();
          setLastVerificationTime(now);
          
          if (dbCheck.matches) {
            console.log(`✅ Token verified in database (${reason})`);
            return true;
          } else if (dbCheck.exists && !dbCheck.matches) {
            console.log(`⚠️ Token in database is different. Will register new token.`);
            // Continue to registration below
          } else {
            console.log(`⚠️ Token not found in database. Will register.`);
            // Continue to registration below
          }
        } else {
          return true; // Skip if recently verified
        }
      }

      // Check database before registering (unless forced)
      if (!force) {
        console.log(`🔍 Checking if token exists in database (${reason})...`);
        const dbCheck = await checkTokenInDatabase();
        setLastVerificationTime(Date.now());
        
        if (dbCheck.matches) {
          console.log(`✅ Token already exists in database and matches. Skipping registration (${reason})`);
          setLastRegisteredToken(tokenToRegister);
          return true;
        }
        
        if (dbCheck.exists && !dbCheck.matches) {
          console.log(`⚠️ Token in database is different. Current: ${tokenToRegister.substring(0, 30)}..., Saved: ${dbCheck.savedToken?.substring(0, 30)}...`);
          // Continue to register new token
        } else {
          console.log(`⚠️ Token not found in database. Will register now.`);
          // Continue to register
        }
      }

      // Throttle: Don't register if last registration was less than 30 seconds ago (unless forced)
      const now = Date.now();
      const timeSinceLastRegistration = now - lastRegistrationTime;
      const THROTTLE_INTERVAL = 30000; // 30 seconds

      if (!force && timeSinceLastRegistration < THROTTLE_INTERVAL) {
        const remainingSeconds = Math.ceil((THROTTLE_INTERVAL - timeSinceLastRegistration) / 1000);
        console.log(`⏸️ Throttling token registration (${reason}) - last registration was ${remainingSeconds}s ago. Skipping...`);
        return false;
      }

      try {
        setIsRegisteringToken(true);
        console.log('📤 Registering push token with backend...', {
          reason,
          force,
          hasDeviceToken: !!devicePushToken,
          hasExpoToken: !!expoPushToken,
          platform: Platform.OS,
          tokenPreview: tokenToRegister?.substring(0, 30) + '...',
        });

        const payload = {
          fcm_token: devicePushToken ?? expoPushToken ?? undefined,
          expo_push_token: expoPushToken && devicePushToken !== expoPushToken ? expoPushToken : undefined,
          device_type: Platform.OS,
          app_version: Constants.expoConfig?.version,
          runtime_version: Constants.expoConfig?.runtimeVersion,
        };

        console.log('📡 Making API call to /user/fcm-token with payload:', {
          hasFcmToken: !!payload.fcm_token,
          hasExpoToken: !!payload.expo_push_token,
          deviceType: payload.device_type,
        });

        await authAPI.registerFcmToken(payload);

        console.log('✅ Push token registered with backend successfully');
        setLastRegisteredToken(tokenToRegister);
        setLastRegistrationTime(now);
        setLastVerificationTime(now);
        return true;
      } catch (error: any) {
        console.error('❌ Failed to register push token with backend:', error);
        console.error('Error details:', {
          message: error?.message,
          status: error?.response?.status,
          statusText: error?.response?.statusText,
          data: error?.response?.data,
          url: error?.config?.url,
        });
        return false;
      } finally {
        setIsRegisteringToken(false);
      }
    },
    [devicePushToken, expoPushToken, isAuthenticated, isRegisteringToken, lastRegisteredToken, lastRegistrationTime, lastVerificationTime, checkTokenInDatabase]
  );

  const triggerPushTokenRegistration = useCallback(
    async (options?: { forceRefresh?: boolean }) => {
      const { forceRefresh = false } = options ?? {};

      console.log('🧪 Manual push token registration triggered', { forceRefresh });

      let latestExpoToken = expoPushToken;
      let latestDeviceToken = devicePushToken;

      try {
        if (forceRefresh || (!latestExpoToken && !latestDeviceToken)) {
          const expoTokenResult = await getExpoPushToken();
          if (expoTokenResult) {
            latestExpoToken = expoTokenResult;
          }

          if (!latestDeviceToken) {
            try {
              const deviceTokenResult = await Notifications.getDevicePushTokenAsync();
              if (deviceTokenResult?.data) {
                latestDeviceToken = deviceTokenResult.data;
                setDevicePushToken(deviceTokenResult.data);
                console.log('✅ Device push token (manual) generated:', deviceTokenResult.data);
              }
            } catch (deviceTokenError) {
              console.error('Failed to fetch device push token during manual registration:', deviceTokenError);
            }
          }
        }

        if (!isAuthenticated) {
          return {
            success: false,
            message: 'User not authenticated. Please log in and try again.',
            expoToken: latestExpoToken ?? null,
            deviceToken: latestDeviceToken ?? null,
          };
        }

        const tokenToRegister = latestDeviceToken || latestExpoToken;
        if (!tokenToRegister) {
          return {
            success: false,
            message: 'Push token not available yet. Grant notification permissions and try again.',
            expoToken: latestExpoToken ?? null,
            deviceToken: latestDeviceToken ?? null,
          };
        }

        const registrationSucceeded = await registerPushTokenWithBackend('manual trigger', forceRefresh);

        return {
          success: !!registrationSucceeded,
          message: registrationSucceeded
            ? 'Push token registered with backend successfully.'
            : 'Failed to register push token with backend. Check logs for details.',
          expoToken: latestExpoToken ?? null,
          deviceToken: latestDeviceToken ?? null,
        };
      } catch (error: any) {
        console.error('Error during manual push token registration:', error);
        return {
          success: false,
          message: error?.message || 'Unexpected error during push token registration.',
          expoToken: latestExpoToken ?? null,
          deviceToken: latestDeviceToken ?? null,
        };
      }
    },
    [
      devicePushToken,
      expoPushToken,
      getExpoPushToken,
      isAuthenticated,
      registerPushTokenWithBackend,
    ]
  );

  const checkPermissionStatus = async (): Promise<{ granted: boolean; status: string }> => {
    try {
      if (!Device.isDevice) {
        return { granted: false, status: 'not_device' };
      }

      const { status } = await Notifications.getPermissionsAsync();
      return {
        granted: status === 'granted',
        status: status,
      };
    } catch (error) {
      console.error('Error checking permission status:', error);
      return { granted: false, status: 'error' };
    }
  };

  // Check if FCM token is saved in backend and sync if missing
  const verifyAndSyncFcmToken = useCallback(async (): Promise<boolean> => {
    if (!isAuthenticated) {
      console.log('🔒 Skipping FCM token verification - user not authenticated');
      return false;
    }

    const currentToken = devicePushToken || expoPushToken;
    if (!currentToken) {
      console.log('⏳ No token available to verify');
      return false;
    }

    // Throttle verification: Don't verify if last registration was less than 10 seconds ago
    const now = Date.now();
    const timeSinceLastRegistration = now - lastRegistrationTime;
    const VERIFICATION_THROTTLE = 10000; // 10 seconds

    if (timeSinceLastRegistration < VERIFICATION_THROTTLE) {
      console.log(`⏸️ Throttling token verification - last registration was ${Math.ceil(timeSinceLastRegistration / 1000)}s ago`);
      return false;
    }

    try {
      console.log('🔍 Verifying FCM token is saved in backend...');
      
      // Fetch user profile to check if token is saved
      const response = await authAPI.getProfile();
      const userData = response.data?.data || response.data?.user || response.data;
      
      if (!userData) {
        console.warn('⚠️ Could not fetch user profile to verify token');
        return false;
      }

      const savedToken = userData.fcm_token;
      const tokenToCheck = devicePushToken || expoPushToken;

      // Check if token matches
      if (savedToken && savedToken === tokenToCheck) {
        console.log('✅ FCM token is already saved in backend');
        setLastRegisteredToken(tokenToCheck);
        return true;
      }

      // Token is missing or different - register it (but respect throttling)
      if (!savedToken || savedToken !== tokenToCheck) {
        console.log('⚠️ FCM token not found or different in backend. Syncing...', {
          hasSavedToken: !!savedToken,
          savedTokenPreview: savedToken ? savedToken.substring(0, 30) + '...' : 'none',
          currentTokenPreview: tokenToCheck.substring(0, 30) + '...',
        });

        const success = await registerPushTokenWithBackend('token verification sync', false); // Don't force, respect throttling
        if (success) {
          console.log('✅ FCM token synced successfully');
          return true;
        } else {
          console.warn('⚠️ Failed to sync FCM token (may be throttled)');
          return false;
        }
      }

      return true;
    } catch (error: any) {
      console.error('❌ Error verifying FCM token:', error);
      // Don't throw - this is a background check
      return false;
    }
  }, [isAuthenticated, devicePushToken, expoPushToken, registerPushTokenWithBackend, lastRegistrationTime]);

  const getDiagnostics = async (): Promise<{
    deviceInfo: any;
    permissionStatus: any;
    projectId: string | null;
    appOwnership: string;
    isExpoGo: boolean;
    errors: string[];
  }> => {
    const errors: string[] = [];
    const diagnostics: any = {
      deviceInfo: {},
      permissionStatus: {},
      projectId: null,
      appOwnership: 'unknown',
      isExpoGo: false,
      errors: [],
    };

    try {
      // Device info
      diagnostics.deviceInfo = {
        isDevice: Device.isDevice,
        brand: Device.brand,
        modelName: Device.modelName,
        osName: Device.osName,
        osVersion: Device.osVersion,
        platformApiLevel: Device.platformApiLevel,
      };

      // App ownership
      diagnostics.appOwnership = Constants.appOwnership || 'unknown';
      diagnostics.isExpoGo = Constants.appOwnership === 'expo';

      // Project ID
      diagnostics.projectId = Constants.expoConfig?.extra?.eas?.projectId || null;
      if (!diagnostics.projectId) {
        errors.push('Project ID not found in app.json');
      }

      // Permission status
      try {
        const permStatus = await Notifications.getPermissionsAsync();
        diagnostics.permissionStatus = {
          status: permStatus.status,
          granted: permStatus.granted,
          canAskAgain: permStatus.canAskAgain,
          expires: permStatus.expires,
        };
      } catch (permError: any) {
        errors.push(`Permission check error: ${permError?.message || String(permError)}`);
      }

      // Try to get tokens to see what errors occur
      try {
        if (diagnostics.permissionStatus.granted) {
          const projectId = diagnostics.projectId;
          if (projectId) {
            try {
              const expoToken = await Notifications.getExpoPushTokenAsync({ projectId });
              diagnostics.expoTokenSuccess = !!expoToken?.data;
            } catch (expoError: any) {
              const errorMsg = expoError?.message || String(expoError);
              errors.push(`Expo token error: ${errorMsg}`);
              diagnostics.expoTokenError = errorMsg;
            }

            try {
              const deviceToken = await Notifications.getDevicePushTokenAsync();
              diagnostics.deviceTokenSuccess = !!deviceToken?.data;
              diagnostics.deviceTokenType = deviceToken?.type;
            } catch (deviceError: any) {
              const errorMsg = deviceError?.message || String(deviceError);
              errors.push(`Device token error: ${errorMsg}`);
              diagnostics.deviceTokenError = errorMsg;
            }
          }
        }
      } catch (tokenError: any) {
        errors.push(`Token generation error: ${tokenError?.message || String(tokenError)}`);
      }

      diagnostics.errors = errors;
    } catch (error: any) {
      errors.push(`Diagnostic error: ${error?.message || String(error)}`);
      diagnostics.errors = errors;
    }

    return diagnostics;
  };

  const requestPermissions = async (): Promise<boolean> => {
    if (!Device.isDevice) {
      console.log('Must use physical device for Push Notifications');
      return false;
    }

    try {
      // First check current status
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      
      // If already granted, try to generate tokens
      if (existingStatus === 'granted') {
        console.log('✅ Permissions already granted, attempting to generate tokens...');
        const token = await getExpoPushToken();
        // Return true if permissions are granted (even if token generation fails)
        // Token generation can fail for other reasons (Firebase not configured, etc.)
        return true;
      }

      // Request permissions if not granted
      const { status } = await Notifications.requestPermissionsAsync();
      const granted = status === 'granted';
      
      if (granted) {
        console.log('✅ Permissions granted, attempting to generate tokens...');
        // Try to generate tokens after permissions are granted
        await getExpoPushToken();
      }
      
      return granted;
    } catch (error) {
      console.error('Error requesting permissions:', error);
      return false;
    }
  };

  const updateAppBadge = async (count: number) => {
    try {
      // Use badge service to manage app icon badge
      await badgeService.setBadgeCount(count);
    } catch (error) {
      console.error('Failed to update app badge:', error);
    }
  };

  const scheduleLocalNotification = async (title: string, body: string, data?: any) => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: true,
        badge: unreadCount + 1,
      },
      trigger: null, // Send immediately
    });
  };

  const showForegroundNotification = async (title: string, body: string, data?: any) => {
    try {
      // Show notification even when app is in foreground
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: true,
          badge: unreadCount + 1,
        },
        trigger: null, // Send immediately
      });
    } catch (error) {
      console.error('Error showing foreground notification:', error);
    }
  };

  const setActiveConversation = (conversationId: number | null) => {
    setActiveConversationId(conversationId);
  };

  const clearActiveConversation = () => {
    setActiveConversationId(null);
  };

  useEffect(() => {
    // Debounce registration on auth/token change to prevent rapid successive calls
    if (registrationTimeoutRef.current) {
      clearTimeout(registrationTimeoutRef.current);
    }

    registrationTimeoutRef.current = setTimeout(() => {
      registerPushTokenWithBackend('auth/token change').catch((error) => {
        console.error('Error attempting to register push token after auth/token change:', error);
      });
    }, 1000); // Wait 1 second before registering after auth change

    return () => {
      if (registrationTimeoutRef.current) {
        clearTimeout(registrationTimeoutRef.current);
      }
    };
  }, [isAuthenticated, devicePushToken, expoPushToken]); // Only depend on actual values, not the function

  useEffect(() => {
    // Initialize notifications with better error handling
    let mounted = true;
    
    const initializeNotifications = async () => {
      try {
        // Add small delay to ensure everything is initialized
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get Expo push token on app start - wrap in try-catch to prevent crashes
        if (mounted) {
          getExpoPushToken()
            .then(async () => {
              // Register token first (with small delay to ensure everything is ready)
              await new Promise(resolve => setTimeout(resolve, 500));
              await registerPushTokenWithBackend('initial token fetch');
            })
            .catch(error => {
              console.error('Error getting Expo push token on mount:', error);
              // Don't crash if push token fails - app can work without push notifications
            });
        }
      } catch (error) {
        console.error('Error initializing notifications:', error);
        // Don't crash - notifications are optional
      }
    };
    
    initializeNotifications();

    // Set up periodic token verification (every 10 minutes)
    // This ensures the token is still in the database and refreshes if needed
    if (isAuthenticated) {
      const PERIODIC_CHECK_INTERVAL = 600000; // 10 minutes
      
      periodicCheckIntervalRef.current = setInterval(() => {
        if (mounted && isAuthenticated && (devicePushToken || expoPushToken)) {
          console.log('🔄 Periodic token verification check...');
          registerPushTokenWithBackend('periodic check').catch(error => {
            console.error('Error during periodic token check:', error);
          });
        }
      }, PERIODIC_CHECK_INTERVAL);
    }

    // Track app state changes with error handling
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      try {
        console.log('App state changed from', appState, 'to', nextAppState);
        if (mounted) {
          setAppState(nextAppState);
          
          // When app becomes active, verify FCM token is saved
          if (nextAppState === 'active' && isAuthenticated) {
            // Small delay to ensure everything is ready
            setTimeout(() => {
              verifyAndSyncFcmToken().catch(error => {
                console.error('Error verifying FCM token on app active:', error);
              });
            }, 2000); // Wait 2 seconds after app becomes active
          }
        }
      } catch (error) {
        console.error('Error handling app state change:', error);
      }
    };

    let appStateSubscription: any = null;
    try {
      appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
    } catch (error) {
      console.error('Error setting up app state listener:', error);
    }

    // Listen for notification interactions with error handling
    let notificationListener: any = null;
    let responseListener: any = null;
    
    try {
      notificationListener = Notifications.addNotificationReceivedListener(async notification => {
        try {
          console.log('Notification received:', notification);
          console.log('Current app state:', appState);
        
          // Check if this is a new message notification
          const data = notification.request.content.data;
          if (data?.type === 'new_message') {
            const messageId = data.message_id as number | undefined;
            const conversationId = (data.conversation_id || data.conversationId) as number | undefined;
            
            // Prevent duplicate notifications for the same message
            if (messageId && notifiedMessageIdsRef.current.has(messageId)) {
              console.log('Skipping duplicate notification for message:', messageId);
              return;
            }
            
            // Mark this message as notified
            if (messageId) {
              notifiedMessageIdsRef.current.add(messageId);
              // Clean up old message IDs (keep last 100)
              if (notifiedMessageIdsRef.current.size > 100) {
                const idsArray = Array.from(notifiedMessageIdsRef.current);
                notifiedMessageIdsRef.current = new Set(idsArray.slice(-100));
              }
            }
            
            // Update unread count for the conversation
            if (conversationId && typeof conversationId === 'number') {
              try {
                // Increment unread count
                const newCount = (conversationCounts[conversationId] || 0) + 1;
                updateUnreadCount(conversationId, newCount);
                
                // Update badge count - use total unread count
                const totalUnread = Object.values({ ...conversationCounts, [conversationId]: newCount })
                  .reduce((sum: number, count: number) => sum + count, 0);
                await badgeService.setBadgeCount(totalUnread);
              } catch (badgeError) {
                console.error('Error updating badge:', badgeError);
              }
            } else {
              try {
                // If no conversation ID, increment badge anyway
                await badgeService.incrementBadge();
              } catch (badgeError) {
                console.error('Error incrementing badge:', badgeError);
              }
            }
            
            // Only show notification if:
            // 1. App is in background, OR
            // 2. App is in foreground but user is NOT viewing this conversation
            const isAppInBackground = appState !== 'active';
            const isViewingThisConversation = conversationId === activeConversationId;
            const shouldShowNotification = isAppInBackground || !isViewingThisConversation;
            
            if (shouldShowNotification) {
              const title = (data.sender_name as string) || 'New Message';
              const body = notification.request.content.body || 'You have a new message';
              
              console.log('Showing notification for new message:', { 
                title, 
                body, 
                appState, 
                conversationId, 
                activeConversationId,
                isViewingThisConversation 
              });
              
              // Small delay to ensure the notification shows
              setTimeout(() => {
                showForegroundNotification(title, body, data).catch((err: unknown) => {
                  console.error('Error showing foreground notification:', err);
                });
              }, 100);
            } else {
              console.log('Suppressing notification - user is viewing this conversation:', {
                conversationId,
                activeConversationId,
                appState
              });
            }
          }
        } catch (error) {
          console.error('Error in notification listener:', error);
          // Don't let notification errors crash the app
        }
      });

      responseListener = Notifications.addNotificationResponseReceivedListener(async response => {
        try {
          console.log('Notification response:', response);
        // Handle notification tap - navigate to conversation
        const conversationId = response.notification.request.content.data?.conversationId;
        if (conversationId) {
          // You can add navigation logic here
          console.log('Navigate to conversation:', conversationId);
        }
        // DON'T clear badge immediately when user taps notification
        // Badge will be cleared when user actually reads the messages (via markAsRead)
        // This allows the badge to persist if user taps notification but doesn't read messages
        } catch (error) {
          console.error('Error in notification response listener:', error);
          // Don't let notification response errors crash the app
        }
      });

    } catch (error) {
      console.error('Error setting up notification listeners:', error);
      // Don't crash - notifications are optional
    }

    return () => {
      mounted = false;
      if (periodicCheckIntervalRef.current) {
        clearInterval(periodicCheckIntervalRef.current);
        periodicCheckIntervalRef.current = null;
      }
      try {
        appStateSubscription?.remove();
        notificationListener?.remove();
        responseListener?.remove();
      } catch (error) {
        console.error('Error cleaning up notification listeners:', error);
      }
    };
  }, [appState, conversationCounts, activeConversationId, isAuthenticated, devicePushToken, expoPushToken, registerPushTokenWithBackend]);

  const value: NotificationContextType = {
    unreadCount,
    groupUnreadCount,
    conversationCounts,
    expoPushToken,
    devicePushToken,
    updateUnreadCount,
    updateGroupUnreadCount,
    resetUnreadCount,
    resetAllCounts,
    checkPermissionStatus,
    requestPermissions,
    getDiagnostics,
    scheduleLocalNotification,
    showForegroundNotification,
    getExpoPushToken,
    triggerPushTokenRegistration,
    verifyAndSyncFcmToken,
    setActiveConversation,
    clearActiveConversation,
  };

  // Set the notification context in the service
  useEffect(() => {
    notificationService.setNotificationContext(value);
  }, [value]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}; 