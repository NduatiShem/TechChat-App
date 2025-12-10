import LastMessagePreview from '@/components/LastMessagePreview';
import GroupAvatar from '@/components/GroupAvatar';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useTheme } from '@/context/ThemeContext';
import { groupsAPI } from '@/services/api';
import { getGroups as getDbGroups, initDatabase, saveGroups as saveDbGroups } from '@/services/database';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Hybrid Cache Strategy: AsyncStorage (fast) + SQLite (persistent) + API (source of truth)
const GROUPS_CACHE_KEY = '@techchat_groups';

interface Group {
  id: number;
  name: string;
  description?: string;
  owner_id: number;
  last_message?: string;
  last_message_date?: string;
  created_at: string;
  updated_at: string;
  users?: any[];
  unread_count?: number; // Unread message count for this group
  avatar_url?: string; // Group profile picture URL
  last_message_attachments?: {
    id: number;
    name: string;
    mime: string;
    url: string;
  }[];
}

export const options = {
  title: "Groups",
};

export default function GroupsScreen() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [filteredGroups, setFilteredGroups] = useState<Group[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const { user } = useAuth();
  const { currentTheme } = useTheme();
  const { updateGroupUnreadCount } = useNotifications();

  const isDark = currentTheme === 'dark';
  const [dbInitialized, setDbInitialized] = useState(false);

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
        console.error('[Groups] Failed to initialize database:', error);
        if (mounted) {
          setDbInitialized(true);
        }
      }
    };
    initDb();
    return () => {
      mounted = false;
    };
  }, []);

  // ✅ HYBRID CACHE: Load from AsyncStorage (fastest, instant display)
  const loadAsyncStorageGroups = async (): Promise<Group[]> => {
    try {
      const cachedData = await AsyncStorage.getItem(GROUPS_CACHE_KEY);
      if (!cachedData) return [];
      
      const groups = JSON.parse(cachedData);
      if (!Array.isArray(groups)) return [];
      
      return groups;
    } catch (error) {
      console.error('[Groups] Error loading from AsyncStorage:', error);
      return [];
    }
  };

  // ✅ HYBRID CACHE: Save to AsyncStorage (fast cache layer)
  const saveAsyncStorageGroups = async (groups: Group[]): Promise<void> => {
    try {
      await AsyncStorage.setItem(GROUPS_CACHE_KEY, JSON.stringify(groups));
    } catch (error) {
      console.error('[Groups] Error saving to AsyncStorage:', error);
    }
  };

  // Load groups from SQLite (persistent storage)
  const loadCachedGroups = async (): Promise<Group[]> => {
    try {
      if (!dbInitialized) return [];
      
      const dbGroups = await getDbGroups();
      
      // Transform database format to UI format
      return dbGroups.map(group => ({
        id: group.id,
        name: group.name,
        description: group.description || undefined,
        owner_id: group.owner_id || 0,
        last_message: group.last_message || undefined,
        last_message_date: group.last_message_date || undefined,
        created_at: group.created_at,
        updated_at: group.updated_at,
        unread_count: group.unread_count,
        avatar_url: group.avatar_url || undefined,
      }));
    } catch (error) {
      console.error('[Groups] Error loading from database:', error);
      return [];
    }
  };

  const loadGroups = async (forceRefresh = false) => {
    // ✅ HYBRID CACHE STRATEGY:
    // 1. Load AsyncStorage first (instant display)
    // 2. Fetch API in background (update both caches)
    // 3. On error, keep showing AsyncStorage (never clear)

    // STEP 1: Load AsyncStorage immediately (fastest, instant display)
    const asyncStorageGroups = await loadAsyncStorageGroups();
    if (asyncStorageGroups.length > 0) {
      setGroups(asyncStorageGroups);
      setFilteredGroups(asyncStorageGroups);
      setIsLoading(false); // Show data immediately, don't wait for API
    }

    // If offline and not forcing refresh, use cached data only
    if (!isOnline && !forceRefresh) {
      // Try SQLite as fallback if AsyncStorage is empty
      if (asyncStorageGroups.length === 0) {
        const sqliteGroups = await loadCachedGroups();
        if (sqliteGroups.length > 0) {
          setGroups(sqliteGroups);
          setFilteredGroups(sqliteGroups);
          // Also save to AsyncStorage for next time
          await saveAsyncStorageGroups(sqliteGroups);
        }
      }
      return;
    }

    // STEP 2: Fetch from API in background (update both caches)
    try {
      const response = await groupsAPI.getAll();
      const groupsData = response.data;
      
      // Ensure groupsData is always an array
      const safeGroupsData = Array.isArray(groupsData) ? groupsData : [];
      
      // ✅ HYBRID CACHE: If API returns empty, try all fallbacks
      if (safeGroupsData.length === 0) {
        // Try AsyncStorage first
        if (asyncStorageGroups.length > 0) {
          setGroups(asyncStorageGroups);
          setFilteredGroups(asyncStorageGroups);
          setIsLoading(false);
          return;
        }
        // Try SQLite
        const sqliteGroups = await loadCachedGroups();
        if (sqliteGroups.length > 0) {
          setGroups(sqliteGroups);
          setFilteredGroups(sqliteGroups);
          await saveAsyncStorageGroups(sqliteGroups);
          setIsLoading(false);
          return;
        }
      }
      
      // Sync unread counts from backend to notification context
      if (safeGroupsData.length > 0) {
        let totalGroupUnread = 0;
        safeGroupsData.forEach((group) => {
          const unreadCount = group.unread_count || 0;
          totalGroupUnread += unreadCount;
        });
        updateGroupUnreadCount(totalGroupUnread);
      }
      
      setGroups(safeGroupsData);
      setFilteredGroups(safeGroupsData);
      
      // ✅ HYBRID CACHE: Save to both AsyncStorage (fast) and SQLite (persistent)
      // Save to AsyncStorage first (fastest)
      await saveAsyncStorageGroups(safeGroupsData);
      
      // Save groups to SQLite for offline access
      if (dbInitialized) {
        try {
          const groupsToSave = safeGroupsData.map((group: any) => ({
            id: group.id,
            name: group.name || 'Unknown Group',
            description: group.description || null,
            owner_id: group.owner_id || null,
            avatar_url: group.avatar_url || null,
            member_count: group.users?.length || group.member_count || 0,
            last_message: group.last_message || null,
            last_message_date: group.last_message_date || group.updated_at || null,
            unread_count: group.unread_count ?? 0,
            created_at: group.created_at || new Date().toISOString(),
            updated_at: group.updated_at || group.last_message_date || new Date().toISOString(),
          }));
          await saveDbGroups(groupsToSave);
        } catch (dbError) {
          console.error('[Groups] Error saving to database:', dbError);
          // Continue even if SQLite fails - AsyncStorage is already saved
        }
      }
    } catch (error: any) {
      console.error('Failed to load groups from API:', error);
      
      // ✅ HYBRID CACHE: On API error, try all fallbacks but NEVER clear existing data
      // Priority: AsyncStorage → SQLite → Keep existing state
      
      // If we already have data from AsyncStorage, keep it (don't clear)
      if (groups.length > 0) {
        setIsLoading(false);
        return;
      }
      
      // Try SQLite fallback
      const sqliteGroups = await loadCachedGroups();
      if (sqliteGroups.length > 0) {
        setGroups(sqliteGroups);
        setFilteredGroups(sqliteGroups);
        // Also save to AsyncStorage for next time
        await saveAsyncStorageGroups(sqliteGroups);
        setIsLoading(false);
        return;
      }
      
      // Try AsyncStorage one more time (in case it wasn't loaded initially)
      const asyncStorageGroups = await loadAsyncStorageGroups();
      if (asyncStorageGroups.length > 0) {
        setGroups(asyncStorageGroups);
        setFilteredGroups(asyncStorageGroups);
        setIsLoading(false);
        return;
      }
      
      // ✅ CRITICAL: Only show empty state if ALL three sources are empty
      // Never clear state on error - preserve existing data
      if (groups.length === 0) {
        // All caches empty - this is truly empty, not an app failure
        setGroups([]);
        setFilteredGroups([]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadGroups();
    setIsRefreshing(false);
  };

  // Filter groups based on search query
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredGroups(groups);
    } else {
      const filtered = groups.filter(group =>
        group.name && group.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredGroups(filtered);
    }
  }, [searchQuery, groups]);

  // Monitor network state
  useEffect(() => {
    // Get initial network state
    NetInfo.fetch().then(state => {
      setIsOnline(state.isConnected ?? false);
    });

    // Subscribe to network state changes
    const unsubscribe = NetInfo.addEventListener(state => {
      const connected = state.isConnected ?? false;
      const wasOffline = !isOnline;
      setIsOnline(connected);
      
      // If we just came back online, refresh groups
      if (connected && wasOffline && user) {
        loadGroups(true);
      }
    });

    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isOnline]);

  useEffect(() => {
    // Only load groups if user is authenticated and database is initialized
    if (user && dbInitialized) {
      const loadData = async () => {
        try {
          // ✅ HYBRID CACHE: Load AsyncStorage first (instant display)
          const asyncStorageGroups = await loadAsyncStorageGroups();
          if (asyncStorageGroups.length > 0) {
            setGroups(asyncStorageGroups);
            setFilteredGroups(asyncStorageGroups);
            setIsLoading(false); // Show data immediately
          } else {
            // Try SQLite as fallback
            const sqliteGroups = await loadCachedGroups();
            if (sqliteGroups.length > 0) {
              setGroups(sqliteGroups);
              setFilteredGroups(sqliteGroups);
              // Save to AsyncStorage for next time
              await saveAsyncStorageGroups(sqliteGroups);
              setIsLoading(false);
            } else {
              // No cache available - show loading spinner
              setIsLoading(true);
            }
          }
          
          // STEP 2: Fetch from API in background (always) - updates both caches
          try {
            await loadGroups(); // This fetches from API and saves to both caches
          } catch (apiError) {
            console.error('[Groups] API fetch failed:', apiError);
            // Don't clear state - keep showing cached data
            setIsLoading(false);
          }
        } catch (error) {
          console.error('[Groups] Error in loadData:', error);
          setIsLoading(false);
        }
      };
      
      loadData();
      
      // Then load from API (will update SQLite if successful)
      loadGroups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]); // loadGroups is stable, no need to include

  // Refresh groups when screen comes into focus
  // Reload groups when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      // Only reload if user is authenticated and database is initialized
      if (user && dbInitialized) {
        // ✅ HYBRID CACHE: Show AsyncStorage instantly, then fetch fresh from API
        const refreshData = async () => {
          // Show AsyncStorage data instantly (if available)
          const asyncStorageGroups = await loadAsyncStorageGroups();
          if (asyncStorageGroups.length > 0) {
            setGroups(asyncStorageGroups);
            setFilteredGroups(asyncStorageGroups);
          }
          
          // Fetch fresh data from API in background (updates both caches)
          try {
            await loadGroups(); // This fetches from API and updates both caches
          } catch (error) {
            // If API fails, cached data is already displayed
            if (__DEV__) {
              console.error('[Groups] Background refresh failed:', error);
            }
          }
        };
        
        refreshData();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, dbInitialized]) // loadGroups is stable, no need to include
  );

  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return ' ';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return ' ';
      const now = new Date();
      const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

      if (diffInHours < 24) {
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return timeStr || ' ';
      } else if (diffInHours < 168) { // 7 days
        const dayStr = date.toLocaleDateString([], { weekday: 'short' });
        return dayStr || ' ';
      } else {
        const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        return dateStr || ' ';
      }
    } catch {
      return ' ';
    }
  };

  const renderGroup = ({ item }: { item: Group }) => (
    <TouchableOpacity
      onPress={() => router.push(`/chat/group/${item.id}`)}
      onLongPress={() => {
        const groupData = encodeURIComponent(JSON.stringify(item));
        router.push(`/group-info?id=${item.id}&groupData=${groupData}`);
      }}
      className={`flex-row items-center p-4 border-b ${
        isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}
      style={{
        shadowColor: isDark ? '#000' : '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: isDark ? 0.1 : 0.05,
        shadowRadius: 2,
        elevation: 1,
      }}
    >
      {/* Avatar */}
      <View className="relative mr-4">
        <GroupAvatar
          avatarUrl={item.avatar_url}
          name={item.name}
          size={48}
        />
        {/* Online indicator for active groups */}
        {item.last_message_date && (
          <View className="absolute -bottom-1 -right-1 w-4 h-4 bg-secondary rounded-full border-2 border-white"></View>
        )}
      </View>

      {/* Content */}
      <View className="flex-1">
        <View className="flex-row justify-between items-center mb-1">
          <View className="flex-1 flex-row items-center">
            <Text
              className={`font-semibold text-base flex-1 ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
              numberOfLines={1}
            >
              {item.name ? String(item.name) : ' '}
            </Text>
            {/* Show unread count on the right side - like WhatsApp */}
            {item.unread_count > 0 && (
              <View 
                className="ml-2 h-5 px-1.5 rounded-full bg-green-500 items-center justify-center"
                style={{ minWidth: 20 }}
              >
                <Text className="text-white text-xs font-bold">
                  {item.unread_count > 99 ? '99+' : item.unread_count.toString()}
                </Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center">
            {item.owner_id === user?.id && (
              <MaterialCommunityIcons
                name="crown"
                size={14}
                color="#39B54A"
                style={{ marginRight: 4 }}
              />
            )}
            {item.last_message_date && (
              <Text
                className={`text-xs ml-2 ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                {formatDate(item.last_message_date)}
              </Text>
            )}
          </View>
        </View>
        
        {item.description && (
          <Text
            className={`text-sm mb-1 ${
              isDark ? 'text-gray-300' : 'text-gray-600'
            }`}
            numberOfLines={1}
          >
            {item.description ? String(item.description) : ' '}
          </Text>
        )}
        
        {item.last_message && (
          <LastMessagePreview
            message={item.last_message || ''}
            isDark={isDark}
            attachments={item.last_message_attachments}
          />
        )}
      </View>
    </TouchableOpacity>
  );

  const handleCreateGroup = () => {
    // Check if user is admin (handle both boolean true and number 1)
    const isUserAdmin = user?.is_admin === true || user?.is_admin === 1;
    if (!isUserAdmin) {
      Alert.alert(
        'Permission Denied',
        'Only administrators can create groups.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Navigate to create group screen
    router.push('/create-group');
  };

  // Check if user is admin (handle both boolean true and number 1)
  const isAdmin = user?.is_admin === true || user?.is_admin === 1;

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

  const sortedGroups = [...filteredGroups].sort((a, b) => {
    if (!a.last_message_date) return 1;
    if (!b.last_message_date) return -1;
    return new Date(b.last_message_date).getTime() - new Date(a.last_message_date).getTime();
  });

  return (
    <SafeAreaView
      edges={['top']}
      className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-white'}`}
    >
      {/* Header with Welcome Message and Search */}
      <View
        className={`px-4 py-4 border-b ${
          isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}
      >
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-1">
            <Text
              className={`text-lg font-semibold ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
            >
              Groups
            </Text>
            <Text
              className={`text-sm ${
                isDark ? 'text-gray-400' : 'text-gray-600'
              }`}
            >
              {groups.length || 0} group{(groups.length || 0) !== 1 ? 's' : ''} available
            </Text>
          </View>
          {isAdmin && (
            <TouchableOpacity
              onPress={handleCreateGroup}
              className="w-10 h-10 rounded-full bg-primary items-center justify-center"
            >
              <MaterialCommunityIcons name="plus" size={24} color="white" />
            </TouchableOpacity>
          )}
        </View>
        
        {/* Search Bar */}
        <View className="relative">
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search groups..."
            placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
            className={`w-full px-4 py-3 pl-10 rounded-lg border ${
              isDark
                ? 'bg-gray-700 border-gray-600 text-white'
                : 'bg-gray-50 border-gray-300 text-gray-900'
            }`}
          />
          <View className="absolute left-3 top-3">
            <MaterialCommunityIcons
              name="magnify"
              size={20}
              color={isDark ? '#9CA3AF' : '#6B7280'}
            />
          </View>
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              className="absolute right-3 top-3"
            >
              <MaterialCommunityIcons
                name="close-circle"
                size={20}
                color={isDark ? '#9CA3AF' : '#6B7280'}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Groups List */}
      <FlatList
        data={sortedGroups}
        renderItem={renderGroup}
        keyExtractor={(item) => item.id.toString()}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={isDark ? '#283891' : '#283891'}
          />
        }
        ListEmptyComponent={
          <View className="flex-1 justify-center items-center py-12">
            <MaterialCommunityIcons
              name={searchQuery ? "magnify" : "account-group"}
              size={64}
              color={isDark ? '#6B7280' : '#9CA3AF'}
            />
            <Text
              className={`text-lg font-semibold mt-4 ${
                isDark ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              {searchQuery ? 'No groups found' : 'No groups yet'}
            </Text>
            <Text
              className={`text-base text-center mt-2 px-8 ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              {searchQuery 
                ? `No groups match "${searchQuery}"`
                : isAdmin 
                  ? 'Create a group to start chatting with multiple people'
                  : 'No groups available yet. Contact an administrator to create a group.'
              }
            </Text>
            {isAdmin && !searchQuery && (
              <TouchableOpacity
                onPress={handleCreateGroup}
                className="mt-4 px-6 py-3 bg-primary rounded-lg"
              >
                <Text className="text-white font-semibold">Create Group</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        contentContainerStyle={{}}
      />

      {/* Floating Action Button for Admin */}
      {isAdmin && (
        <TouchableOpacity
          onPress={handleCreateGroup}
          className={`absolute bottom-6 right-6 w-14 h-14 rounded-full items-center justify-center shadow-lg ${
            isDark ? 'bg-primary shadow-primary' : 'bg-primary shadow-gray-400'
          }`}
          style={{
            elevation: 8,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
          }}
        >
          <MaterialCommunityIcons
            name="plus"
            size={28}
            color="white"
          />
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
} 