import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { conversationsAPI, groupsAPI } from '@/services/api';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    ScrollView,
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
  created_at: string;
  updated_at: string;
}

export default function CreateGroupScreen() {
  const [groupName, setGroupName] = useState('');
  const [description, setDescription] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { user } = useAuth();
  const { currentTheme } = useTheme();

  const isDark = currentTheme === 'dark';

  const loadUsers = async () => {
    try {
      // Get users from conversations API (filter out groups and current user)
      const response = await conversationsAPI.getAll();
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
      
      // Filter out groups and current user
      const userList = usersData.filter((item: any) => 
        item.is_user && item.id !== user?.id
      );
      
      setUsers(userList);
    } catch (error) {
      console.error('Failed to load users:', error);
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // loadUsers is stable, no need to include

  const filteredUsers = users.filter(user =>
    (user.name && user.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (user.email && user.email.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const toggleUserSelection = (userId: number) => {
    setSelectedUsers(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      Alert.alert('Error', 'Please enter a group name');
      return;
    }

    if (selectedUsers.length === 0) {
      Alert.alert('Error', 'Please select at least one user');
      return;
    }

    setIsCreating(true);
    try {
      await groupsAPI.create({
        name: groupName.trim(),
        description: description.trim() || undefined,
        members: selectedUsers,
      });

      Alert.alert(
        'Success',
        'Group created successfully!',
        [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ]
      );
    } catch (error: any) {
      console.error('Failed to create group:', error);
      let errorMessage = 'Failed to create group';
      
      if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.data?.errors) {
        const errors = error.response.data.errors;
        errorMessage = Object.keys(errors).map(key => 
          `${key}: ${errors[key].join(', ')}`
        ).join('\n');
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  const renderUser = ({ item }: { item: User }) => {
    const isSelected = selectedUsers.includes(item.id);
    
    return (
      <TouchableOpacity
        onPress={() => toggleUserSelection(item.id)}
        className={`flex-row items-center p-4 border-b ${
          isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        } ${isSelected ? (isDark ? 'bg-primary/20' : 'bg-primary/10') : ''}`}
      >
        {/* Avatar */}
        <View className="w-12 h-12 rounded-full bg-primary items-center justify-center mr-4">
          <MaterialCommunityIcons name="account" size={24} color="white" />
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

        {/* Selection Indicator */}
        <View className={`w-6 h-6 rounded-full border-2 items-center justify-center ${
          isSelected 
            ? 'bg-secondary border-secondary' 
            : (isDark ? 'border-gray-600' : 'border-gray-300')
        }`}>
          {isSelected && (
            <MaterialCommunityIcons name="check" size={16} color="white" />
          )}
        </View>
      </TouchableOpacity>
    );
  };

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
    <SafeAreaView className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
      {/* Header */}
      <View
        className={`flex-row items-center p-4 border-b ${
          isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}
      >
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <MaterialCommunityIcons name="arrow-left" size={24} color={isDark ? '#fff' : '#000'} />
        </TouchableOpacity>
        <Text
          className={`text-lg font-semibold ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}
        >
          Create Group
        </Text>
      </View>

      <ScrollView className="flex-1">
        {/* Group Details */}
        <View className="p-4">
          <Text
            className={`text-base font-medium mb-2 ${
              isDark ? 'text-gray-200' : 'text-gray-700'
            }`}
          >
            Group Name *
          </Text>
          <TextInput
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Enter group name"
            placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
            className={`w-full px-4 py-3 rounded-lg border mb-4 ${
              isDark
                ? 'bg-gray-800 border-gray-600 text-white'
                : 'bg-gray-50 border-gray-300 text-gray-900'
            }`}
          />

          <Text
            className={`text-base font-medium mb-2 ${
              isDark ? 'text-gray-200' : 'text-gray-700'
            }`}
          >
            Description (Optional)
          </Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Enter group description"
            placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
            multiline
            numberOfLines={3}
            className={`w-full px-4 py-3 rounded-lg border mb-6 ${
              isDark
                ? 'bg-gray-800 border-gray-600 text-white'
                : 'bg-gray-50 border-gray-300 text-gray-900'
            }`}
          />
        </View>

        {/* Users Section */}
        <View className="px-4 mb-4">
          <Text
            className={`text-base font-medium mb-2 ${
              isDark ? 'text-gray-200' : 'text-gray-700'
            }`}
          >
            Select Users ({selectedUsers.length} selected)
          </Text>
          
          {/* Search Bar */}
          <View className="relative mb-4">
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search users..."
              placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
              className={`w-full px-4 py-3 pl-10 rounded-lg border ${
                isDark
                  ? 'bg-gray-800 border-gray-600 text-white'
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
          </View>
        </View>

        {/* Users List */}
        <FlatList
          data={filteredUsers}
          renderItem={renderUser}
          keyExtractor={(item) => item.id.toString()}
          scrollEnabled={false}
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
                  : 'There are no other users to add to the group'
                }
              </Text>
            </View>
          }
        />
      </ScrollView>

      {/* Create Button */}
      <View className="p-4 border-t border-gray-200 dark:border-gray-700">
        <TouchableOpacity
          onPress={handleCreateGroup}
          disabled={isCreating || !groupName.trim() || selectedUsers.length === 0}
          className={`w-full py-3 rounded-lg ${
            isCreating || !groupName.trim() || selectedUsers.length === 0
              ? 'bg-gray-400'
              : 'bg-primary'
          }`}
        >
          <Text className="text-white text-center font-semibold text-lg">
            {isCreating ? 'Creating...' : 'Create Group'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
} 