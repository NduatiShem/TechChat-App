import UserAvatar from '@/components/UserAvatar';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { groupsAPI } from '@/services/api';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    ScrollView,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface GroupMember {
  id: number;
  name: string;
  email: string;
  avatar_url?: string;
  pivot?: {
    is_admin?: boolean;
  };
}

interface GroupInfo {
  id: number;
  name: string;
  description?: string;
  owner_id: number;
  created_at: string;
  updated_at: string;
  users: GroupMember[];
}

export default function GroupInfoScreen() {
  const { id, groupData } = useLocalSearchParams();
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const { user } = useAuth();
  const { currentTheme } = useTheme();

  const isDark = currentTheme === 'dark';
  const isAdmin = user?.is_admin === true;
  const isOwner = groupInfo?.owner_id === user?.id;

  const loadGroupInfo = async () => {
    try {
      // Try to use passed group data first
      if (groupData) {
        const parsedGroupData = JSON.parse(decodeURIComponent(groupData as string));
        setGroupInfo(parsedGroupData);
        setIsLoading(false);
        return;
      }

      // Fallback: try to get from groups list
      const response = await groupsAPI.getAll();
      const group = response.data.find((g: any) => g.id === Number(id));
      
      if (group) {
        // Create a basic group info structure
        setGroupInfo({
          id: group.id,
          name: group.name,
          description: group.description,
          owner_id: group.owner_id,
          created_at: group.created_at,
          updated_at: group.updated_at,
          users: [] // We don't have user details from getAll()
        });
      } else {
        Alert.alert('Error', 'Group not found');
      }
    } catch (error) {
      console.error('Failed to load group info:', error);
      Alert.alert('Error', 'Failed to load group information');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadGroupInfo();
  }, [id, groupData]);

  const handleDeleteGroup = () => {
    if (!isAdmin && !isOwner) {
      Alert.alert('Permission Denied', 'Only administrators or group owners can delete groups.');
      return;
    }

    Alert.alert(
      'Delete Group',
      `Are you sure you want to delete "${groupInfo?.name}"? This action cannot be undone.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: confirmDeleteGroup,
        },
      ]
    );
  };

  const confirmDeleteGroup = async () => {
    setIsDeleting(true);
    try {
      await groupsAPI.delete(Number(id));
      Alert.alert(
        'Success',
        'Group deleted successfully!',
        [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ]
      );
    } catch (error: any) {
      console.error('Failed to delete group:', error);
      let errorMessage = 'Failed to delete group';
      
      if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setIsDeleting(false);
    }
  };

  const getGroupAvatarInitials = (groupName: string | null | undefined) => {
    if (!groupName || typeof groupName !== 'string') {
      return 'G';
    }
    return groupName
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const renderMember = ({ item }: { item: GroupMember }) => (
    <View className={`flex-row items-center p-4 border-b ${
      isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
    }`}>
      {/* Member Avatar */}
      <View className="mr-4">
        <UserAvatar
          avatarUrl={item.avatar_url}
          name={item.name}
          size={48}
        />
      </View>

      {/* Member Info */}
      <View className="flex-1">
        <View className="flex-row items-center">
          <Text
            className={`font-semibold text-base ${
              isDark ? 'text-white' : 'text-gray-900'
            }`}
          >
            {item.name}
          </Text>
          {item.id === groupInfo?.owner_id && (
            <View className="ml-2">
              <MaterialCommunityIcons name="crown" size={16} color="#F59E0B" />
            </View>
          )}
        </View>
        <Text
          className={`text-sm ${
            isDark ? 'text-gray-400' : 'text-gray-600'
          }`}
        >
          {item.email}
        </Text>
      </View>

      {/* Role Badge */}
      {item.id === groupInfo?.owner_id && (
        <View className="bg-yellow-100 dark:bg-yellow-900/20 px-2 py-1 rounded">
          <Text className="text-yellow-800 dark:text-yellow-200 text-xs font-medium">
            Owner
          </Text>
        </View>
      )}
    </View>
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

  if (!groupInfo) {
    return (
      <SafeAreaView
        className={`flex-1 justify-center items-center ${
          isDark ? 'bg-gray-900' : 'bg-white'
        }`}
      >
        <MaterialCommunityIcons
          name="alert-circle"
          size={64}
          color={isDark ? '#6B7280' : '#9CA3AF'}
        />
        <Text
          className={`text-lg font-semibold mt-4 ${
            isDark ? 'text-gray-300' : 'text-gray-600'
          }`}
        >
          Group not found
        </Text>
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
          Group Info
        </Text>
      </View>

      <ScrollView className="flex-1">
        {/* Group Header */}
        <View className={`p-6 border-b ${
          isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}>
          <View className="flex-row items-center mb-4">
            {/* Group Avatar */}
            <View className="w-20 h-20 rounded-full bg-primary items-center justify-center mr-4">
              <Text className="text-white font-bold text-2xl">
                {getGroupAvatarInitials(groupInfo.name)}
              </Text>
            </View>

            {/* Group Info */}
            <View className="flex-1">
              <Text
                className={`text-2xl font-bold mb-1 ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}
              >
                {groupInfo.name}
              </Text>
              {groupInfo.description && (
                <Text
                  className={`text-base ${
                    isDark ? 'text-gray-300' : 'text-gray-600'
                  }`}
                >
                  {groupInfo.description}
                </Text>
              )}
            </View>
          </View>

          {/* Group Stats */}
          <View className="flex-row justify-between">
            <View className="items-center">
              <Text
                className={`text-2xl font-bold ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}
              >
                {groupInfo.users.length}
              </Text>
              <Text
                className={`text-sm ${
                  isDark ? 'text-gray-400' : 'text-gray-600'
                }`}
              >
                Members
              </Text>
            </View>
            <View className="items-center">
              <Text
                className={`text-sm ${
                  isDark ? 'text-gray-400' : 'text-gray-600'
                }`}
              >
                Created
              </Text>
              <Text
                className={`text-sm font-medium ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}
              >
                {formatDate(groupInfo.created_at)}
              </Text>
            </View>
          </View>
        </View>

        {/* Members Section */}
        <View className="p-4">
          <Text
            className={`text-lg font-semibold mb-4 ${
              isDark ? 'text-white' : 'text-gray-900'
            }`}
          >
            Members {groupInfo.users.length > 0 ? `(${groupInfo.users.length})` : ''}
          </Text>

          {groupInfo.users.length > 0 ? (
            <FlatList
              data={groupInfo.users}
              renderItem={renderMember}
              keyExtractor={(item) => item.id.toString()}
              scrollEnabled={false}
            />
          ) : (
            <View className={`p-4 rounded-lg ${
              isDark ? 'bg-gray-800' : 'bg-gray-50'
            }`}>
              <Text
                className={`text-center ${
                  isDark ? 'text-gray-400' : 'text-gray-600'
                }`}
              >
                Member details not available
              </Text>
            </View>
          )}
        </View>

        {/* Admin Actions */}
        {(isAdmin || isOwner) && (
          <View className="p-4 border-t border-gray-200 dark:border-gray-700">
            <Text
              className={`text-lg font-semibold mb-4 ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
            >
              Admin Actions
            </Text>

            <TouchableOpacity
              onPress={handleDeleteGroup}
              disabled={isDeleting}
              className={`flex-row items-center p-4 rounded-lg ${
                isDark ? 'bg-red-900/20' : 'bg-red-50'
              }`}
            >
              <MaterialCommunityIcons
                name="delete"
                size={24}
                color="#EF4444"
              />
              <Text className="ml-3 text-base text-red-600 font-medium">
                {isDeleting ? 'Deleting...' : 'Delete Group'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
} 