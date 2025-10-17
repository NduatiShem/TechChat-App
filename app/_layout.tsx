import { NotificationBadge } from "@/components/NotificationBadge";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { NotificationProvider, useNotifications } from "@/context/NotificationContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Stack, Tabs, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, AppState, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../global.css";

function AppTabsLayout() {
  const { currentTheme } = useTheme();
  const { unreadCount, resetAllCounts } = useNotifications();
  const pathname = usePathname();
  const isDark = currentTheme === 'dark';

  // Hide tab bar in chat screens
  const shouldHideTabBar = pathname?.includes('/chat/');

  // Handle app state changes for badge management
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'active') {
        // App came to foreground - clear badge count
        resetAllCounts();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [resetAllCounts]);

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
              <MaterialCommunityIcons name="account-group" size={size} color={color} />
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
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider>
          <NotificationProvider>
            <AppLayout />
          </NotificationProvider>
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
