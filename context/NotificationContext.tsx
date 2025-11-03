import { authAPI } from '@/services/api';
import { badgeService } from '@/services/badgeService';
import { notificationService } from '@/services/notificationService';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';

interface NotificationContextType {
  unreadCount: number;
  conversationCounts: Record<number, number>;
  expoPushToken: string | null;
  updateUnreadCount: (conversationId: number, count: number) => void;
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

  const resetAllCounts = () => {
    setConversationCounts({});
    setUnreadCount(0);
    
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

      // Get Expo push token
      const token = await Notifications.getExpoPushTokenAsync({
        projectId: projectId,
      });
      
      if (token.data) {
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
    // Get Expo push token on app start
    getExpoPushToken();

    // Track app state changes
    const handleAppStateChange = (nextAppState: string) => {
      console.log('App state changed from', appState, 'to', nextAppState);
      setAppState(nextAppState);
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    // Listen for notification interactions
    const notificationListener = Notifications.addNotificationReceivedListener(async notification => {
      console.log('Notification received:', notification);
      console.log('Current app state:', appState);
      
      // Check if this is a new message notification
      const data = notification.request.content.data;
      if (data?.type === 'new_message') {
        // Update unread count for the conversation
        const conversationId = data.conversation_id || data.conversationId;
        if (conversationId) {
          // Increment unread count
          const newCount = (conversationCounts[conversationId] || 0) + 1;
          updateUnreadCount(conversationId, newCount);
          
          // Update badge count - use total unread count
          const totalUnread = Object.values({ ...conversationCounts, [conversationId]: newCount })
            .reduce((sum, count) => sum + count, 0);
          await badgeService.setBadgeCount(totalUnread);
        } else {
          // If no conversation ID, increment badge anyway
          await badgeService.incrementBadge();
        }
        
        // Always show notification, regardless of app state
        // This ensures users see notifications even when the app is open
        const title = data.sender_name || 'New Message';
        const body = notification.request.content.body || 'You have a new message';
        
        console.log('Showing notification for new message:', { title, body, appState });
        
        // Small delay to ensure the notification shows
        setTimeout(() => {
          showForegroundNotification(title, body, data);
        }, 100);
      }
    });

    const responseListener = Notifications.addNotificationResponseReceivedListener(async response => {
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
    });

    return () => {
      appStateSubscription?.remove();
      notificationListener?.remove();
      responseListener?.remove();
    };
  }, [appState, conversationCounts]);

  const value: NotificationContextType = {
    unreadCount,
    conversationCounts,
    expoPushToken,
    updateUnreadCount,
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