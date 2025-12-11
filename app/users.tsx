import UserAvatar from '@/components/UserAvatar';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { usersAPI } from '@/services/api';
import { getUsers as getDbUsers, initDatabase, saveUsers as saveDbUsers } from '@/services/database';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface User {
  id: number;
  name: string;
  email: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

// Hybrid Cache Strategy: AsyncStorage (fast) + SQLite (persistent) + API (source of truth)
const USERS_CACHE_KEY = '@techchat_users';

export default function UsersScreen() {
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [dbInitialized, setDbInitialized] = useState(false);
  const { user } = useAuth();
  const { currentTheme } = useTheme();

  const isDark = currentTheme === 'dark';

  // Initialize database on mount
  useEffect(() => {
    let mounted = true;
    const initDb = async () => {
      try {
        await initDatabase();
        if (mounted) {
          setDbInitialized(true);
        }
      } catch (error) {
        console.error('[Users] Failed to initialize database:', error);
        if (mounted) {
          setDbInitialized(true); // Still allow app to work
        }
      }
    };
    initDb();
    return () => {
      mounted = false;
    };
  }, []);

  // ✅ HYBRID CACHE: Load from AsyncStorage (fastest, instant display)
  const loadAsyncStorageUsers = async (): Promise<User[]> => {
    try {
      const cachedData = await AsyncStorage.getItem(USERS_CACHE_KEY);
      if (!cachedData) return [];
      
      const users = JSON.parse(cachedData);
      if (!Array.isArray(users)) return [];
      
      // Filter out current user
      return users.filter((item) => item.id !== user?.id);
    } catch (error) {
      console.error('[Users] Error loading from AsyncStorage:', error);
      return [];
    }
  };

  // ✅ HYBRID CACHE: Save to AsyncStorage (fast cache layer)
  const saveAsyncStorageUsers = async (usersList: User[]): Promise<void> => {
    try {
      await AsyncStorage.setItem(USERS_CACHE_KEY, JSON.stringify(usersList));
    } catch (error) {
      console.error('[Users] Error saving to AsyncStorage:', error);
    }
  };

  // Load cached users from SQLite (persistent storage)
  const loadCachedUsers = async (): Promise<User[]> => {
    if (!dbInitialized) return [];
    
    try {
      const cachedUsers = await getDbUsers();
      if (cachedUsers && cachedUsers.length > 0) {
        // Filter out current user and convert to User interface
        const userList = cachedUsers
          .filter((item) => item.id !== user?.id)
          .map((item) => ({
            id: item.id,
            name: item.name,
            email: item.email,
            avatar_url: item.avatar_url || undefined,
            created_at: item.created_at,
            updated_at: item.updated_at,
          }));
        
        return userList;
      }
    } catch (error) {
      console.error('[Users] Error loading cached users:', error);
    }
    return [];
  };

  // ✅ API-FIRST STRATEGY: Try API first, fallback to AsyncStorage/SQLite only if API fails
  const loadUsers = async () => {
    // Only show empty state if API returns empty AND all fallbacks are empty AND requests completed successfully
    
    // STEP 1: Try API first (source of truth)
    let apiSuccess = false;
    let apiUsers: User[] = [];
    let apiError: any = null;
    
    try {
      const response = await usersAPI.getAll();
      let usersData = response.data;
      
      if (typeof response.data === 'string') {
        try {
          usersData = JSON.parse(response.data);
        } catch (parseError) {
          console.error('Failed to parse users data:', parseError);
          throw parseError;
        }
      }
      
      // Ensure we have an array and filter out the current user
      if (Array.isArray(usersData)) {
        const userList = usersData.filter((item: any) => 
          item.id !== user?.id
        );
        
        // Mark API as successful
        apiSuccess = true;
        apiUsers = userList;
        
        // Save to both AsyncStorage (fast) and SQLite (persistent)
        await saveAsyncStorageUsers(userList);
        
        // Save to SQLite in background (persistent)
        if (dbInitialized) {
          try {
            const usersToSave = userList.map((item: any) => ({
              id: item.id,
              name: item.name,
              email: item.email,
              avatar_url: item.avatar_url || null,
              created_at: item.created_at || new Date().toISOString(),
              updated_at: item.updated_at || new Date().toISOString(),
            }));
            await saveDbUsers(usersToSave);
            
            if (__DEV__) {
              console.log(`[Users] Saved ${usersToSave.length} users to database`);
            }
          } catch (dbError) {
            console.error('[Users] Error saving to database:', dbError);
          }
        }
      } else {
        console.error('Response data is not an array:', usersData);
        throw new Error('Response data is not an array');
      }
    } catch (error: any) {
      apiError = error;
      console.error('Failed to load users from API:', error);
    }
    
    // STEP 2: Handle API result or fallback to AsyncStorage/SQLite
    if (apiSuccess) {
      // ✅ API succeeded - use API data (even if empty, it's the truth)
      setUsers(apiUsers);
      setFilteredUsers(apiUsers);
      setIsLoading(false);
    } else {
      // ❌ API failed - fallback to AsyncStorage → SQLite
      // Try AsyncStorage first
      const asyncStorageUsers = await loadAsyncStorageUsers();
      if (asyncStorageUsers.length > 0) {
        setUsers(asyncStorageUsers);
        setFilteredUsers(asyncStorageUsers);
        setIsLoading(false);
        return;
      }
      
      // Try SQLite fallback
      const sqliteUsers = await loadCachedUsers();
      if (sqliteUsers.length > 0) {
        setUsers(sqliteUsers);
        setFilteredUsers(sqliteUsers);
        await saveAsyncStorageUsers(sqliteUsers);
        setIsLoading(false);
        return;
      }
      
      // ❌ Both API and fallbacks are empty - show empty state
      setUsers([]);
      setFilteredUsers([]);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Only load users if database is initialized
    if (dbInitialized) {
      // ✅ STAGGERED LOADING: Delay to prevent concurrent database access
      setTimeout(() => {
        const loadData = async () => {
          try {
            // ✅ HYBRID CACHE: Load AsyncStorage first (instant display)
            const asyncStorageUsers = await loadAsyncStorageUsers();
            if (asyncStorageUsers.length > 0) {
              setUsers(asyncStorageUsers);
              setFilteredUsers(asyncStorageUsers);
              setIsLoading(false); // Show data immediately
            } else {
              // Try SQLite as fallback
              const sqliteUsers = await loadCachedUsers();
              if (sqliteUsers.length > 0) {
                setUsers(sqliteUsers);
                setFilteredUsers(sqliteUsers);
                // Save to AsyncStorage for next time
                await saveAsyncStorageUsers(sqliteUsers);
                setIsLoading(false);
              } else {
                // No cache available - show loading spinner
                setIsLoading(true);
              }
            }
            
            // STEP 2: Fetch from API in background (always) - updates both caches
            try {
              await loadUsers(); // This fetches from API and saves to both caches
            } catch (apiError) {
              console.error('[Users] API fetch failed:', apiError);
              // Don't clear state - keep showing cached data
              setIsLoading(false);
            }
          } catch (error) {
            console.error('[Users] Error in loadData:', error);
            setIsLoading(false);
          }
        };
        
        loadData();
      }, 500); // 500ms delay for users (staggered from conversations and groups)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbInitialized]); // Load when database is initialized

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredUsers(users);
    } else {
      const filtered = users.filter(user =>
        (user.name && user.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (user.email && user.email.toLowerCase().includes(searchQuery.toLowerCase()))
      );
      setFilteredUsers(filtered);
    }
  }, [searchQuery, users]);

  const startConversation = (selectedUser: User) => {
    router.push(`/chat/user/${selectedUser.id}`);
  };

  const renderUser = ({ item }: { item: User }) => (
    <TouchableOpacity
      onPress={() => startConversation(item)}
      className={`flex-row items-center p-4 border-b ${
        isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}
    >
      {/* Avatar */}
      <View className="mr-4">
        <UserAvatar
          avatarUrl={item.avatar_url}
          name={item.name}
          size={48}
        />
      </View>

      {/* User Info */}
      <View className="flex-1">
        <Text
          className={`font-semibold text-base ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}
        >
          {item.name}
        </Text>
        <Text
          className={`text-sm ${
            isDark ? 'text-gray-400' : 'text-gray-600'
          }`}
        >
          {item.email}
        </Text>
      </View>

      {/* Arrow */}
      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={isDark ? '#6B7280' : '#9CA3AF'}
      />
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <SafeAreaView
        className={`flex-1 justify-center items-center ${
          isDark ? 'bg-gray-900' : 'bg-white'
        }`}
      >
        <ActivityIndicator size="large" color="#283891" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={['top']}
      className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-white'}`}
    >
      {/* Header */}
      <View
        className={`px-4 py-4 border-b ${
          isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}
      >
        <Text
          className={`text-lg font-semibold mb-2 ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}
        >
          Start New Chat
        </Text>
        <Text
          className={`text-sm mb-3 ${
            isDark ? 'text-gray-400' : 'text-gray-600'
          }`}
        >
          Select a user to start a conversation
        </Text>
        
        {/* Search Bar */}
        <View
          className={`flex-row items-center px-3 py-2 rounded-lg ${
            isDark ? 'bg-gray-700' : 'bg-gray-100'
          }`}
        >
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={isDark ? '#6B7280' : '#9CA3AF'}
            style={{ marginRight: 8 }}
          />
          <TextInput
            placeholder="Search users..."
            placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
            value={searchQuery}
            onChangeText={setSearchQuery}
            className={`flex-1 text-base ${
              isDark ? 'text-white' : 'text-gray-900'
            }`}
          />
        </View>
      </View>

      {/* Users List */}
      <FlatList
        data={filteredUsers}
        renderItem={renderUser}
        keyExtractor={(item) => `user-${item.id}`}
        ListEmptyComponent={
          <View className="flex-1 justify-center items-center py-12">
            <MaterialCommunityIcons
              name="account-group"
              size={64}
              color={isDark ? '#6B7280' : '#9CA3AF'}
            />
            <Text
              className={`text-lg font-semibold mt-4 ${
                isDark ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              {searchQuery ? 'No users found' : 'No users available'}
            </Text>
            <Text
              className={`text-base text-center mt-2 px-8 ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              {searchQuery 
                ? 'Try adjusting your search terms'
                : 'You are the only user in the app. Invite others to start chatting!'
              }
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
} 