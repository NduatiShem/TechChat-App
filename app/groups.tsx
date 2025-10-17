import LastMessagePreview from '@/components/LastMessagePreview';
import { useAuth } from '@/context/AuthContext';
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
}

export const options = {
  title: "Groups",
};

export default function GroupsScreen() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { user } = useAuth();
  const { currentTheme } = useTheme();

  const isDark = currentTheme === 'dark';

  const loadGroups = async () => {
    try {
      const response = await groupsAPI.getAll();
      setGroups(response.data);
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
    >
      {/* Avatar */}
      <View className="w-12 h-12 rounded-full bg-primary items-center justify-center mr-4">
        <MaterialCommunityIcons name="account-group" size={24} color="white" />
      </View>

      {/* Content */}
      <View className="flex-1">
        <View className="flex-row justify-between items-center mb-1">
          <Text
            className={`font-semibold text-base ${
              isDark ? 'text-white' : 'text-gray-900'
            }`}
          >
            {item.name}
          </Text>
          {item.last_message_date && (
            <Text
              className={`text-xs ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              {formatDate(item.last_message_date)}
            </Text>
          )}
        </View>
        
        {item.description && (
          <Text
            className={`text-sm mb-1 ${
              isDark ? 'text-gray-300' : 'text-gray-600'
            }`}
            numberOfLines={1}
          >
            {item.description}
          </Text>
        )}
        
        {item.last_message && (
          <LastMessagePreview
            message={item.last_message}
            isDark={isDark}
          />
        )}
      </View>

      {/* Owner indicator */}
      {item.owner_id === user?.id && (
        <View className="ml-2 flex-row items-center">
          <MaterialCommunityIcons
            name="crown"
            size={16}
            color="#39B54A"
          />
          <Text className="text-secondary text-xs font-medium ml-1">Admin</Text>
        </View>
      )}
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

  const sortedGroups = [...groups].sort((a, b) => {
    if (!a.last_message_date) return 1;
    if (!b.last_message_date) return -1;
    return new Date(b.last_message_date) - new Date(a.last_message_date);
  });

  return (
    <SafeAreaView
      edges={['top']}
      className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-white'}`}
    >
      {/* Groups Info */}
      <View
        className={`px-4 py-4 border-b ${
          isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}
      >
        <View className="flex-row justify-between items-center">
          <Text
            className={`text-base ${
              isDark ? 'text-gray-300' : 'text-gray-600'
            }`}
          >
            {groups.length} group{groups.length !== 1 ? 's' : ''}
          </Text>
          {isAdmin && (
            <TouchableOpacity
              onPress={handleCreateGroup}
              className="w-10 h-10 rounded-full bg-primary items-center justify-center"
            >
              <MaterialCommunityIcons name="plus" size={24} color="white" />
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
              name="account-group"
              size={64}
              color={isDark ? '#6B7280' : '#9CA3AF'}
            />
            <Text
              className={`text-lg font-semibold mt-4 ${
                isDark ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              No groups yet
            </Text>
            <Text
              className={`text-base text-center mt-2 px-8 ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              {isAdmin 
                ? 'Create a group to start chatting with multiple people'
                : 'No groups available yet. Contact an administrator to create a group.'
              }
            </Text>
            {isAdmin && (
              <TouchableOpacity
                onPress={handleCreateGroup}
                className="mt-4 px-6 py-3 bg-primary rounded-lg"
              >
                <Text className="text-white font-semibold">Create Group</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
} 