import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NotificationBadge } from "@/components/NotificationBadge";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { NotificationProvider, useNotifications } from "@/context/NotificationContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { usersAPI } from "@/services/api";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Stack, Tabs, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { ActivityIndicator, AppState, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../global.css";

// Prevent splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

function AppTabsLayout() {
  const { currentTheme } = useTheme();
  const { unreadCount, groupUnreadCount, resetAllCounts, updateUnreadCount } = useNotifications();
  const { isAuthenticated } = useAuth();
  const pathname = usePathname();
  const isDark = currentTheme === 'dark';
  const lastSeenIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const ENABLE_UNREAD_SYNC = false; // Temporarily disabled until v1.2.0

  // Hide tab bar in chat screens
  const shouldHideTabBar = pathname?.includes('/chat/');

  // Update last_seen_at when app is active
  const updateLastSeen = async () => {
    if (!isAuthenticated) return;
    
    try {
      await usersAPI.updateLastSeen();
      console.log('Updated last_seen_at');
    } catch (error) {
      console.error('Error updating last_seen_at:', error);
    }
  };

  // Fetch and sync unread count with backend when app starts/becomes active
  const syncUnreadCount = async () => {
    if (!isAuthenticated || !ENABLE_UNREAD_SYNC) return;
    
    try {
      const { messagesAPI } = await import('@/services/api');
      const response = await messagesAPI.getUnreadCount();
      const totalUnread = response.data?.total_unread || response.data?.unread_count || 0;
      
      console.log('Synced unread count from backend:', totalUnread);
      
      // Update badge with actual unread count from backend
      if (totalUnread > 0) {
        const { badgeService } = await import('@/services/badgeService');
        await badgeService.setBadgeCount(totalUnread);
      }
      
      // Optionally update the notification context with unread counts per conversation
      // This depends on your backend API response structure
      if (response.data?.conversations) {
        Object.entries(response.data.conversations).forEach(([conversationId, count]) => {
          updateUnreadCount(parseInt(conversationId), count as number);
        });
      }
    } catch (error: any) {
      // Ignore backend errors for unread sync in v1.0.0
      console.log('Unread count sync disabled or failed:', error?.message || error);
    }
  };

  // Handle app state changes for badge management and last_seen updates
  useEffect(() => {
    if (!isAuthenticated) return; // Don't set up if not authenticated
    
    const handleAppStateChange = (nextAppState: string) => {
      try {
        if (nextAppState === 'active') {
          // App came to foreground - sync unread count from backend
          // DON'T clear badge - let user see how many unread messages they have
          // Badge will be updated based on actual unread count from backend
          updateLastSeen().catch(err => console.error('updateLastSeen error:', err));
          syncUnreadCount().catch(err => console.error('syncUnreadCount error:', err));
          
          // Set up periodic updates every 2 minutes while app is active
          if (lastSeenIntervalRef.current) {
            clearInterval(lastSeenIntervalRef.current);
          }
          lastSeenIntervalRef.current = setInterval(() => {
            updateLastSeen().catch(err => console.error('Interval updateLastSeen error:', err));
          }, 2 * 60 * 1000); // Update every 2 minutes
        } else {
          // App went to background - badge should persist on app icon
          // The badge count is already updated via notifications when messages arrive
          // When app goes to background, the badge will show unread count on app icon
          console.log('App went to background - badge count will persist on app icon');
          
          // Clear interval
          if (lastSeenIntervalRef.current) {
            clearInterval(lastSeenIntervalRef.current);
            lastSeenIntervalRef.current = null;
          }
        }
      } catch (error) {
        console.error('Error in handleAppStateChange:', error);
      }
    };

    // Update immediately when component mounts if authenticated
    try {
      updateLastSeen().catch(err => console.error('Initial updateLastSeen error:', err));
      // Sync unread count and badge when app starts
      syncUnreadCount().catch(err => console.error('Initial syncUnreadCount error:', err));
      // Set up periodic updates
      lastSeenIntervalRef.current = setInterval(() => {
        updateLastSeen().catch(err => console.error('Interval updateLastSeen error:', err));
      }, 2 * 60 * 1000); // Update every 2 minutes
    } catch (error) {
      console.error('Error setting up app state listeners:', error);
    }

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      try {
        subscription?.remove();
        if (lastSeenIntervalRef.current) {
          clearInterval(lastSeenIntervalRef.current);
          lastSeenIntervalRef.current = null;
        }
      } catch (error) {
        console.error('Error cleaning up app state listeners:', error);
      }
    };
  }, [isAuthenticated]); // Removed updateUnreadCount and resetAllCounts from dependencies to prevent infinite loops

  return (
    <>
      <StatusBar 
        style={isDark ? 'light' : 'dark'} 
        backgroundColor={isDark ? '#111827' : '#FFFFFF'} 
      />
      <Tabs
        screenOptions={{
          headerShown: false, // Hide all headers
          tabBarStyle: shouldHideTabBar ? { display: 'none' } : {
            backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
            borderTopColor: isDark ? '#374151' : '#E5E7EB',
          },
          tabBarActiveTintColor: '#283891',
          tabBarInactiveTintColor: isDark ? '#9CA3AF' : '#6B7280',
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Messages",
            tabBarIcon: ({ color, size }) => (
              <View style={{ position: 'relative', width: size, height: size }}>
                <MaterialCommunityIcons name="chat-outline" size={size} color={color} />
                <NotificationBadge size="small" />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="groups"
          options={{
            title: "Groups",
            tabBarIcon: ({ color, size }) => (
              <View style={{ position: 'relative', width: size, height: size }}>
                <MaterialCommunityIcons name="account-group" size={size} color={color} />
                {groupUnreadCount > 0 && (
                  <NotificationBadge count={groupUnreadCount} size="small" />
                )}
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="users"
          options={{
            title: "Users",
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="account-plus" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="account" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            href: null, // Hide from tab bar
          }}
        />
        <Tabs.Screen
          name="(auth)"
          options={{
            href: null, // Hide from tab bar
          }}
        />
        <Tabs.Screen
          name="create-group"
          options={{
            href: null, // Hide from tab bar
          }}
        />
        <Tabs.Screen
          name="group-info"
          options={{
            href: null, // Hide from tab bar
          }}
        />
        <Tabs.Screen
          name="api-test"
          options={{
            href: null, // Hide from tab bar
          }}
        />
      </Tabs>
    </>
  );
}

function AuthLayout() {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === 'dark';

  return (
    <>
      <StatusBar 
        style={isDark ? 'light' : 'dark'} 
        backgroundColor={isDark ? '#111827' : '#FFFFFF'} 
      />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
      </Stack>
    </>
  );
}

function AppLayout() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { currentTheme } = useTheme();
  const isDark = currentTheme === 'dark';

  console.log('AppLayout: isLoading:', isLoading, 'isAuthenticated:', isAuthenticated, 'user:', user?.name);

  // Hide splash screen once app is ready
  useEffect(() => {
    if (!isLoading) {
      // App initialization is complete, hide splash screen
      const hideSplash = async () => {
        try {
          await SplashScreen.hideAsync();
          console.log('Splash screen hidden');
        } catch (error) {
          console.error('Error hiding splash screen:', error);
          // Don't crash if hiding splash fails
        }
      };
      
      // Small delay to ensure smooth transition
      const timer = setTimeout(() => {
        hideSplash();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  // Show loading screen while checking authentication
  if (isLoading) {
    return (
      <View className={`flex-1 justify-center items-center ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
        <ActivityIndicator size="large" color="#283891" />
      </View>
    );
  }

  // Show auth screens if not authenticated
  if (!isAuthenticated) {
    console.log('AppLayout: Showing auth screens');
    return <AuthLayout />;
  }

  // Show main app if authenticated
  console.log('AppLayout: Showing main app');
  return <AppTabsLayout />;
}

export default function RootLayout() {
  // Ensure splash screen hides even if there's an error
  useEffect(() => {
    // Fallback: Hide splash screen after 5 seconds max (in case of errors)
    const fallbackTimer = setTimeout(async () => {
      try {
        await SplashScreen.hideAsync();
        console.log('Splash screen hidden (fallback)');
      } catch (error) {
        console.error('Error hiding splash screen (fallback):', error);
      }
    }, 5000);

    return () => clearTimeout(fallbackTimer);
  }, []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <ThemeProvider>
            <NotificationProvider>
              <AppLayout />
            </NotificationProvider>
          </ThemeProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
