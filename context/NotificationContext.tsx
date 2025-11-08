import { authAPI } from '@/services/api';
import { badgeService } from '@/services/badgeService';
import { notificationService } from '@/services/notificationService';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

interface NotificationContextType {
  unreadCount: number;
  groupUnreadCount: number; // Total unread count for groups only
  conversationCounts: Record<number, number>;
  expoPushToken: string | null;
  updateUnreadCount: (conversationId: number, count: number) => void;
  updateGroupUnreadCount: (totalCount: number) => void; // Update total group unread count
  resetUnreadCount: (conversationId: number) => void;
  resetAllCounts: () => void;
  requestPermissions: () => Promise<boolean>;
  scheduleLocalNotification: (title: string, body: string, data?: any) => Promise<void>;
  showForegroundNotification: (title: string, body: string, data?: any) => Promise<void>;
  getExpoPushToken: () => Promise<string | null>;
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
  const [unreadCount, setUnreadCount] = useState(0);
  const [groupUnreadCount, setGroupUnreadCount] = useState(0); // Total unread count for groups only
  const [conversationCounts, setConversationCounts] = useState<Record<number, number>>({});
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);

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
      if (!Device.isDevice) {
        console.log('Must use physical device for Push Notifications');
        return null;
      }

      // Check if we're in Expo Go (which doesn't support push notifications in SDK 53+)
      const isExpoGo = Constants.appOwnership === 'expo';
      if (isExpoGo) {
        console.warn('⚠️ Push notifications are not supported in Expo Go with SDK 53+. Please use a development build instead.');
        console.log('💡 To fix this:');
        console.log('   1. Run: npx eas build --profile development --platform android');
        console.log('   2. Install the development build on your device');
        console.log('   3. Use the development build instead of Expo Go');
        return null;
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        console.log('Failed to get push token for push notification!');
        return null;
      }

      // Get project ID from app.json configuration
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) {
        console.error('Project ID not found in app.json configuration');
        return null;
      }

      // Get Expo push token with error handling for Firebase/FCM
      let token;
      try {
        token = await Notifications.getExpoPushTokenAsync({
          projectId: projectId,
        });
      } catch (error: any) {
        // Handle Firebase/FCM initialization errors gracefully
        const errorMessage = error?.message || String(error);
        if (errorMessage.includes('FirebaseApp') || 
            errorMessage.includes('FCM') || 
            errorMessage.includes('Firebase')) {
          console.warn('⚠️ Firebase/FCM not configured. Push notifications may not work.');
          console.warn('💡 To enable push notifications:');
          console.warn('   1. Follow: https://docs.expo.dev/push-notifications/fcm-credentials/');
          console.warn('   2. Upload google-services.json to Expo using: eas credentials');
          console.warn('   3. Rebuild the app');
          // Don't crash the app - just return null
          return null;
        }
        // Log other errors but don't crash
        console.error('Error getting Expo push token:', error);
        return null;
      }
      
      if (token?.data) {
        console.log('Expo Push Token:', token.data);
        setExpoPushToken(token.data);
        
        // Register token with backend
        try {
          await authAPI.registerFcmToken(token.data);
          console.log('Expo push token registered with backend');
        } catch (error) {
          console.error('Failed to register Expo push token with backend:', error);
        }
        
        return token.data;
      }
      
      return null;
    } catch (error) {
      console.error('Error getting Expo push token:', error);
      return null;
    }
  };

  const requestPermissions = async (): Promise<boolean> => {
    if (Device.isDevice) {
      const token = await getExpoPushToken();
      return token !== null;
    } else {
      console.log('Must use physical device for Push Notifications');
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

  useEffect(() => {
    // Initialize notifications with better error handling
    let mounted = true;
    
    const initializeNotifications = async () => {
      try {
        // Add small delay to ensure everything is initialized
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get Expo push token on app start - wrap in try-catch to prevent crashes
        if (mounted) {
          getExpoPushToken().catch(error => {
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

    // Track app state changes with error handling
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      try {
        console.log('App state changed from', appState, 'to', nextAppState);
        if (mounted) {
          setAppState(nextAppState);
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
          // Update unread count for the conversation
          const conversationId = (data.conversation_id || data.conversationId) as number | undefined;
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
          
          // Always show notification, regardless of app state
          // This ensures users see notifications even when the app is open
          const title = (data.sender_name as string) || 'New Message';
          const body = notification.request.content.body || 'You have a new message';
          
          console.log('Showing notification for new message:', { title, body, appState });
          
          // Small delay to ensure the notification shows
          setTimeout(() => {
            showForegroundNotification(title, body, data).catch((err: unknown) => {
              console.error('Error showing foreground notification:', err);
            });
          }, 100);
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
      try {
        appStateSubscription?.remove();
        notificationListener?.remove();
        responseListener?.remove();
      } catch (error) {
        console.error('Error cleaning up notification listeners:', error);
      }
    };
  }, [appState, conversationCounts]);

  const value: NotificationContextType = {
    unreadCount,
    groupUnreadCount,
    conversationCounts,
    expoPushToken,
    updateUnreadCount,
    updateGroupUnreadCount,
    resetUnreadCount,
    resetAllCounts,
    requestPermissions,
    scheduleLocalNotification,
    showForegroundNotification,
    getExpoPushToken,
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