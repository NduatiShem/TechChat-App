import UserAvatar from '@/components/UserAvatar';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { usersAPI } from '@/services/api';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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

export default function UsersScreen() {
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuth();
  const { currentTheme } = useTheme();

  const isDark = currentTheme === 'dark';

  const loadUsers = async () => {
    try {
      const response = await usersAPI.getAll();
      let usersData = response.data;
      
      if (typeof response.data === 'string') {
        try {
          usersData = JSON.parse(response.data);
        } catch (parseError) {
          console.error('Failed to parse users data:', parseError);
          setUsers([]);
          return;
        }
      }
      
      // Ensure we have an array and filter out the current user
      if (Array.isArray(usersData)) {
        const userList = usersData.filter((item: any) => 
          item.id !== user?.id
        );
        
        setUsers(userList);
        setFilteredUsers(userList);
      } else {
        console.error('Response data is not an array:', usersData);
        setUsers([]);
        setFilteredUsers([]);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

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