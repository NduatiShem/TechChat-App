import LastMessagePreview from '@/components/LastMessagePreview';
import GroupAvatar from '@/components/GroupAvatar';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useTheme } from '@/context/ThemeContext';
import { groupsAPI } from '@/services/api';
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
  last_message_attachments?: Array<{
    id: number;
    name: string;
    mime: string;
    url: string;
  }>;
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
  const { user } = useAuth();
  const { currentTheme } = useTheme();
  const { updateGroupUnreadCount } = useNotifications();

  const isDark = currentTheme === 'dark';

  const loadGroups = async () => {
    try {
      const response = await groupsAPI.getAll();
      const groupsData = response.data;
      
      // Sync unread counts from backend to notification context
      if (Array.isArray(groupsData)) {
        let totalGroupUnread = 0;
        groupsData.forEach((group) => {
          const unreadCount = group.unread_count || 0;
          totalGroupUnread += unreadCount;
          // Don't call updateUnreadCount for groups - that's only for individual conversations
          // Groups have their own counter (groupUnreadCount)
        });
        // Update total group unread count (separate from individual conversations)
        updateGroupUnreadCount(totalGroupUnread);
      }
      
      setGroups(groupsData);
      setFilteredGroups(groupsData);
    } catch (error) {
      console.error('Failed to load groups:', error);
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

  useEffect(() => {
    loadGroups();
  }, []);

  // Refresh groups when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      loadGroups();
    }, [])
  );

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '';
      const now = new Date();
      const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

      if (diffInHours < 24) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (diffInHours < 168) { // 7 days
        return date.toLocaleDateString([], { weekday: 'short' });
      } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }
    } catch (error) {
      return '';
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
              {item.name || ''}
            </Text>
            {/* Show unread count on the right side - like WhatsApp */}
            {item.unread_count && item.unread_count > 0 && (
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
                {formatDate(item.last_message_date) || ''}
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
            {item.description || ''}
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
    // Check if user is admin
    if (!user?.is_admin) {
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

  // Check if user is admin
  const isAdmin = user?.is_admin === true;

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
    return new Date(b.last_message_date) - new Date(a.last_message_date);
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