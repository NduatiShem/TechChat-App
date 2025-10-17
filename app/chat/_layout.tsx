import { useTheme } from "@/context/ThemeContext";
import { Stack } from "expo-router";

export default function ChatLayout() {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === 'dark';

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackTitle: "Back",
        headerStyle: {
          backgroundColor: isDark ? '#1F2937' : '#283891',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      <Stack.Screen
        name="user/[id]"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="group/[id]"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );
} 