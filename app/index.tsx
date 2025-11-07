import LastMessagePreview from '@/components/LastMessagePreview';
import UserAvatar from '@/components/UserAvatar';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useTheme } from '@/context/ThemeContext';
import { conversationsAPI } from '@/services/api';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
  last_message_attachments?: Array<{
    id: number;
    name: string;
    mime: string;
    url: string;
  }>;
  user?: {
    id: number;
    name: string;
    email: string;
    avatar_url?: string;
  };
}

export default function ConversationsScreen() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { user } = useAuth();
  const { currentTheme } = useTheme();
  const { requestPermissions, conversationCounts, updateUnreadCount } = useNotifications();

  const isDark = currentTheme === 'dark';

  const loadConversations = async () => {
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
              setConversations([]);
              return;
            }
          } else {
            setConversations([]);
            return;
          }
        }
      }
      
      // Ensure we have an array
      if (Array.isArray(conversationsData)) {
        // Remove duplicates based on id
        // Backend already filters active users, so we don't need to filter here
        const uniqueConversations = conversationsData.filter((conversation, index, self) => 
          conversation && 
          conversation.id !== undefined && 
          conversation.id !== null &&
          index === self.findIndex(c => c.id === conversation.id)
        );
        
        // Sync unread counts from backend to notification context
        // Update all conversations (including those with 0 unread)
        uniqueConversations.forEach((conversation) => {
          const conversationId = conversation.conversation_id || conversation.id;
          const unreadCount = conversation.unread_count || 0;
          // Update count for each conversation (this will automatically calculate total)
          updateUnreadCount(Number(conversationId), unreadCount);
        });
        
        setConversations(uniqueConversations);
        setFilteredConversations(uniqueConversations);
      } else {
        console.error('Response data is not an array:', conversationsData);
        setConversations([]);
        setFilteredConversations([]);
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
      setConversations([]);
      setFilteredConversations([]);
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadConversations();
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

  useEffect(() => {
    loadConversations();
    // Request notification permissions when the app loads
    requestPermissions();
  }, []);

  // Reload conversations when screen comes into focus (e.g., returning from chat)
  // This ensures unread counts are updated after marking messages as read
  useFocusEffect(
    useCallback(() => {
      loadConversations();
    }, [])
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
    return new Date(b.last_message_date) - new Date(a.last_message_date);
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
            <View className="w-2 h-2 bg-secondary rounded-full mr-2"></View>
            <Text className="text-secondary text-xs font-medium">Online</Text>
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
            return `conversation-${item.id}`;
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
