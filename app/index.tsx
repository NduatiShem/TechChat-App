import LastMessagePreview from '@/components/LastMessagePreview';
import UserAvatar from '@/components/UserAvatar';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useTheme } from '@/context/ThemeContext';
import { conversationsAPI } from '@/services/api';
import { getConversations as getDbConversations, initDatabase, isDatabaseEmpty, saveConversations as saveDbConversations } from '@/services/database';
import { syncConversations, startBackgroundBulkSync } from '@/services/syncService';
import { runAsyncStorageMigration } from '@/utils/migrateAsyncStorage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Conversation {
  id: number;
  name: string;
  email?: string;
  avatar_url?: string;
  is_user: boolean;
  is_group: boolean;
  last_message?: string;
  last_message_date?: string;
  last_message_sender_id?: number; // ID of the sender of the last message
  last_message_read_at?: string | null; // Read receipt timestamp for the last message
  created_at: string;
  updated_at: string;
  user_id?: number; // The actual user ID for user conversations
  conversation_id?: number; // The conversation ID
  unread_count?: number; // Unread message count for this conversation
  last_message_attachments?: {
    id: number;
    name: string;
    mime: string;
    url: string;
  }[];
  user?: {
    id: number;
    name: string;
    email: string;
    avatar_url?: string;
  };
}

// Hybrid Cache Strategy: AsyncStorage (fast) + SQLite (persistent) + API (source of truth)
const CONVERSATIONS_CACHE_KEY = '@techchat_conversations';

export default function ConversationsScreen() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const { user } = useAuth();
  const { currentTheme } = useTheme();
  const { requestPermissions, conversationCounts, updateUnreadCount } = useNotifications();

  const isDark = currentTheme === 'dark';
  const [dbInitialized, setDbInitialized] = useState(false);

  // Initialize database on mount
  useEffect(() => {
    let mounted = true;
    const initDb = async () => {
      try {
        await initDatabase();
        // Run migration from AsyncStorage on first launch
        await runAsyncStorageMigration();
        if (mounted) {
          setDbInitialized(true);
        }
      } catch (error) {
        console.error('[Conversations] Failed to initialize database:', error);
        // Fallback: still allow app to work with AsyncStorage
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

  // Deduplicate conversations helper
  const deduplicateConversations = useCallback((convs: Conversation[]): Conversation[] => {
    const seen = new Map<number, Conversation>();
    for (const conv of convs) {
      if (conv && conv.id !== undefined && conv.id !== null) {
        // Keep the most recent version if duplicate
        const existing = seen.get(conv.id);
        if (!existing || new Date(conv.updated_at || conv.created_at || '') > new Date(existing.updated_at || existing.created_at || '')) {
          seen.set(conv.id, conv);
        }
      }
    }
    return Array.from(seen.values());
  }, []);

  // ✅ HYBRID CACHE: Load from AsyncStorage (fastest, instant display)
  const loadAsyncStorageConversations = async (): Promise<Conversation[]> => {
    try {
      const cachedData = await AsyncStorage.getItem(CONVERSATIONS_CACHE_KEY);
      if (!cachedData) return [];
      
      const conversations = JSON.parse(cachedData);
      if (!Array.isArray(conversations)) return [];
      
      // Filter out groups (messages tab is for individual conversations only)
      const individualConversations = conversations.filter(conv => !conv.is_group);
      return deduplicateConversations(individualConversations);
    } catch (error) {
      console.error('[Conversations] Error loading from AsyncStorage:', error);
      return [];
    }
  };

  // ✅ HYBRID CACHE: Save to AsyncStorage (fast cache layer)
  const saveAsyncStorageConversations = async (convs: Conversation[]): Promise<void> => {
    try {
      await AsyncStorage.setItem(CONVERSATIONS_CACHE_KEY, JSON.stringify(convs));
    } catch (error) {
      console.error('[Conversations] Error saving to AsyncStorage:', error);
    }
  };

  // Load conversations from SQLite (persistent storage) - only individual conversations for messages tab
  const loadCachedConversations = async (): Promise<Conversation[]> => {
    try {
      if (!dbInitialized) return [];
      
      // Only load individual conversations (exclude groups)
      const dbConvs = await getDbConversations('individual');
      
      // Transform database format to UI format
      const conversations = dbConvs.map(conv => ({
        id: conv.conversation_id,
        conversation_id: conv.conversation_id,
        user_id: conv.user_id,
        name: conv.name,
        email: conv.email,
        avatar_url: conv.avatar_url,
        is_user: conv.conversation_type === 'individual',
        is_group: conv.conversation_type === 'group',
        last_message: conv.last_message,
        last_message_date: conv.last_message_date,
        last_message_sender_id: conv.last_message_sender_id,
        last_message_read_at: conv.last_message_read_at,
        unread_count: conv.unread_count,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
      }));
      
      // Deduplicate before returning
      return deduplicateConversations(conversations);
    } catch (error) {
      console.error('[Conversations] Error loading from database:', error);
      return [];
    }
  };

  const loadConversations = async (forceRefresh = false) => {
    // ✅ API-FIRST STRATEGY: Try API first, fallback to AsyncStorage/SQLite only if API fails
    // Only show empty state if API returns empty AND all fallbacks are empty AND requests completed successfully
    
    // If offline and not forcing refresh, use cached data only
    if (!isOnline && !forceRefresh) {
      // Try AsyncStorage first
      const asyncStorageConversations = await loadAsyncStorageConversations();
      if (asyncStorageConversations.length > 0) {
        setConversations(asyncStorageConversations);
        setFilteredConversations(asyncStorageConversations);
        setIsLoading(false);
        return;
      }
      
      // Try SQLite as fallback
      const sqliteConversations = await loadCachedConversations();
      if (sqliteConversations.length > 0) {
        const deduplicated = deduplicateConversations(sqliteConversations);
        setConversations(deduplicated);
        setFilteredConversations(deduplicated);
        await saveAsyncStorageConversations(deduplicated);
        setIsLoading(false);
        return;
      }
      
      // Both empty - show empty state
      setConversations([]);
      setFilteredConversations([]);
      setIsLoading(false);
      return;
    }

    // STEP 1: Try API first (source of truth)
    let apiSuccess = false;
    let apiConversations: Conversation[] = [];
    let apiError: any = null;
    
    try {
      const response = await conversationsAPI.getAll();
      let conversationsData = response.data;
      
      // Handle case where response.data is a JSON string
      if (typeof response.data === 'string') {
        try {
          conversationsData = JSON.parse(response.data);
        } catch (parseError) {
          console.error('Failed to parse JSON string:', parseError);
          // Try to fix common truncation issues
          if (response.data.includes('[') && !response.data.endsWith(']')) {
            try {
              const fixedData = response.data + ']';
              conversationsData = JSON.parse(fixedData);
            } catch (fixError) {
              console.error('Failed to parse fixed JSON array:', fixError);
              // Don't clear conversations on parse error - keep existing data
              setIsLoading(false);
              return;
            }
          } else {
            // Don't clear conversations on parse error - keep existing data
            setIsLoading(false);
            return;
          }
        }
      }
      
      // Convert object to array if needed (handle cases where backend returns object with numeric keys)
      let conversationsArray: Conversation[] = [];
      
      if (Array.isArray(conversationsData)) {
        conversationsArray = conversationsData;
      } else if (conversationsData && typeof conversationsData === 'object') {
        // Handle object with numeric keys like {"0": {...}, "1": {...}}
        const keys = Object.keys(conversationsData);
        const numericKeys = keys.filter(key => !isNaN(Number(key)));
        
        if (numericKeys.length > 0) {
          // Convert object with numeric keys to array
          conversationsArray = numericKeys.map(key => conversationsData[key]).filter(Boolean);
          console.log('Converted object with numeric keys to array:', conversationsArray.length, 'conversations');
        } else {
          // Handle single object (wrap in array)
          conversationsArray = [conversationsData].filter(Boolean);
          console.log('Converted single object to array');
        }
      } else {
        console.error('Response data is not an array or object:', conversationsData);
        // Don't clear conversations if response format is unexpected - keep existing data
        // Only clear if we have no existing conversations
        if (conversations.length === 0) {
          setConversations([]);
          setFilteredConversations([]);
        }
        setIsLoading(false);
        return;
      }
      
      // Remove duplicates and filter out groups (messages tab is for individual conversations only)
      const uniqueConversations = conversationsArray.filter((conversation, index, self) => 
        conversation && 
        conversation.id !== undefined && 
        conversation.id !== null &&
        !conversation.is_group && // Exclude groups from messages tab
        index === self.findIndex(c => c.id === conversation.id)
      );
      
      // Sync unread counts from backend to notification context
      uniqueConversations.forEach((conversation) => {
        const conversationId = conversation.conversation_id || conversation.id;
        const unreadCount = conversation.unread_count || 0;
        updateUnreadCount(Number(conversationId), unreadCount);
      });
      
      // Deduplicate before setting state
      const deduplicated = deduplicateConversations(uniqueConversations);
      
      // Mark API as successful
      apiSuccess = true;
      apiConversations = deduplicated;
      
      // Save to both AsyncStorage (fast) and SQLite (persistent)
      await saveAsyncStorageConversations(deduplicated);
      
      // Save to SQLite database (persistent)
      try {
        const conversationsToSave = uniqueConversations.map(conv => ({
          conversation_id: conv.conversation_id || conv.id,
          conversation_type: conv.is_group ? 'group' : 'individual',
          user_id: conv.is_group ? undefined : (conv.user_id || conv.id),
          group_id: conv.is_group ? (conv.id || conv.conversation_id) : undefined,
          name: conv.name,
          email: conv.email,
          avatar_url: conv.avatar_url,
          last_message: conv.last_message,
          last_message_date: conv.last_message_date || conv.updated_at,
          last_message_sender_id: conv.last_message_sender_id,
          last_message_read_at: conv.last_message_read_at,
          unread_count: conv.unread_count ?? 0,
          created_at: conv.created_at,
          updated_at: conv.updated_at || conv.last_message_date || new Date().toISOString(),
        }));
        await saveDbConversations(conversationsToSave);
      } catch (dbError) {
        console.error('[Conversations] Error saving to database:', dbError);
      }
    } catch (error: any) {
      apiError = error;
      console.error('Failed to load conversations from API:', error);
      
      if (error?.response) {
        console.error('API Error Response:', {
          status: error.response.status,
          data: error.response.data,
          headers: error.response.headers
        });
      }
    }
    
    // STEP 2: Handle API result or fallback to AsyncStorage/SQLite
    if (apiSuccess) {
      // ✅ API succeeded - use API data (even if empty, it's the truth)
      setConversations(apiConversations);
      setFilteredConversations(apiConversations);
      setIsLoading(false);
    } else {
      // ❌ API failed - fallback to AsyncStorage → SQLite
      // Try AsyncStorage first
      const asyncStorageConversations = await loadAsyncStorageConversations();
      if (asyncStorageConversations.length > 0) {
        setConversations(asyncStorageConversations);
        setFilteredConversations(asyncStorageConversations);
        setIsLoading(false);
        return;
      }
      
      // Try SQLite fallback
      const sqliteConversations = await loadCachedConversations();
      if (sqliteConversations.length > 0) {
        const deduplicated = deduplicateConversations(sqliteConversations);
        setConversations(deduplicated);
        setFilteredConversations(deduplicated);
        await saveAsyncStorageConversations(deduplicated);
        setIsLoading(false);
        return;
      }
      
      // ❌ Both API and fallbacks are empty - show empty state
      setConversations([]);
      setFilteredConversations([]);
      setIsLoading(false);
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    // Force refresh even if offline
    await loadConversations(true);
    setIsRefreshing(false);
  };

  // Filter conversations based on search query
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredConversations(conversations);
    } else {
      const filtered = conversations.filter(conversation =>
        conversation.name && conversation.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredConversations(filtered);
    }
  }, [searchQuery, conversations]);

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
      
      // If we just came back online, refresh conversations and start bulk sync
      if (connected && wasOffline && user) {
        loadConversations(true);
        
        // Start background bulk sync when network comes back (non-blocking)
        // This ensures any missing messages are synced
        if (dbInitialized && user.id) {
          console.log('[Conversations] Network came back, starting background bulk sync...');
          startBackgroundBulkSync(user.id, {
            onlyIfEmpty: false, // Always sync when network comes back
            maxConversations: undefined // Sync all conversations
          });
        }
      }
    });

    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isOnline]);

  useEffect(() => {
    // Only load conversations if user is authenticated and database is initialized
    if (user && dbInitialized) {
      // ✅ STAGGERED LOADING: Load immediately (default tab, no delay)
      setIsLoading(true);
      // Small delay to ensure database is fully ready
      setTimeout(() => {
        loadConversations().catch((error) => {
          console.error('[Conversations] Error in loadConversations:', error);
          setIsLoading(false);
        });
      }, 100); // 100ms delay for conversations (default tab)
      
      // Request notification permissions when the app loads
      requestPermissions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, dbInitialized]); // loadConversations and requestPermissions are stable, no need to include

  // Reload conversations when screen comes into focus (e.g., returning from chat)
  // This ensures unread counts are updated after marking messages as read
  useFocusEffect(
    useCallback(() => {
      // Only reload if user is authenticated and database is initialized
      if (user && dbInitialized) {
        // ✅ API-FIRST: Try API first, fallback to cache only if API fails
        loadConversations().catch((error) => {
          if (__DEV__) {
            console.error('[Conversations] Background refresh failed:', error);
          }
        });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, dbInitialized]) // loadConversations is stable, no need to include
  );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffInHours < 168) { // 7 days
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const renderConversation = ({ item }: { item: Conversation }) => {
    // Get avatar URL from either flat structure or nested user object
    const avatarUrl = item.avatar_url || item.user?.avatar_url;
    
    return (
      <TouchableOpacity
        onPress={() => {
          if (item.is_group) {
            router.push(`/chat/group/${item.id}`);
          } else {
            // For user conversations, use user_id if available, otherwise fall back to id
            const userId = item.user_id || item.id;
            router.push(`/chat/user/${userId}`);
          }
        }}
      className={`flex-row items-center p-4 border-b ${
        isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}
    >
      {/* Avatar - no badge on avatar */}
      <View className="relative mr-4">
        <UserAvatar
          avatarUrl={avatarUrl}
          name={item.name}
          size={48}
        />
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
              {item.name}
            </Text>
            {/* Show unread count on the right side - like WhatsApp */}
            {(() => {
              const conversationId = item.conversation_id || item.id;
              const unreadCount = item.unread_count || conversationCounts[conversationId] || 0;
              if (unreadCount > 0) {
                return (
                  <View className="ml-2 min-w-[20] h-5 px-1.5 rounded-full bg-green-500 items-center justify-center">
                    <Text className="text-white text-xs font-bold">
                      {unreadCount > 99 ? '99+' : unreadCount.toString()}
                    </Text>
                  </View>
                );
              }
              return null;
            })()}
          </View>
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
        
        {item.last_message && (
          <LastMessagePreview
            message={item.last_message}
            isDark={isDark}
            attachments={item.last_message_attachments}
            isFromMe={item.last_message_sender_id === user?.id}
            readAt={item.last_message_read_at}
          />
        )}
      </View>
    </TouchableOpacity>
    );
  };

  const sortedConversations = [...filteredConversations].sort((a, b) => {
    if (!a.last_message_date) return 1;
    if (!b.last_message_date) return -1;
    return new Date(b.last_message_date).getTime() - new Date(a.last_message_date).getTime();
  });

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
      {/* Header with Welcome Message and Search */}
      <View
        className={`px-4 py-4 border-b ${
          isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}
      >
        <View className="flex-row items-center justify-between mb-3">
          <Text
            className={`text-base ${
              isDark ? 'text-gray-300' : 'text-gray-600'
            }`}
          >
            Welcome back, {user?.name}
          </Text>
          <View className="flex-row items-center">
            <View className={`w-2 h-2 rounded-full mr-2 ${isOnline ? 'bg-green-500' : 'bg-gray-500'}`}></View>
            <Text className={`text-xs font-medium ${isOnline ? 'text-green-500' : 'text-gray-500'}`}>
              {isOnline ? 'Online' : 'Offline'}
            </Text>
          </View>
        </View>
        
        {/* Search Bar */}
        <View className="relative">
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search conversations..."
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

      {/* Conversations List */}
      <FlatList
        data={sortedConversations}
        renderItem={renderConversation}
        keyExtractor={(item, index) => {
          if (item && item.id !== undefined && item.id !== null) {
            // Include conversation type in key to ensure uniqueness
            const type = item.is_group ? 'group' : 'individual';
            return `conversation-${type}-${item.id}`;
          }
          console.warn('Conversation missing id:', item, 'at index', index);
          return `conversation-fallback-${index}`;
        }}
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
              name={searchQuery ? "magnify" : "chat-outline"}
              size={64}
              color={isDark ? '#6B7280' : '#9CA3AF'}
            />
            <Text
              className={`text-lg font-semibold mt-4 ${
                isDark ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              {searchQuery ? 'No conversations found' : 'No conversations yet'}
            </Text>
            <Text
              className={`text-base text-center mt-2 px-8 ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              {searchQuery 
                ? `No conversations match "${searchQuery}"`
                : 'Tap the + button to start a new conversation'
              }
            </Text>
          </View>
        }
        contentContainerStyle={{}}
      />

      {/* Floating Action Button */}
      <TouchableOpacity
        onPress={() => {
          // Navigate to users screen
          router.push('/users');
        }}
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
    </SafeAreaView>
  );
}
