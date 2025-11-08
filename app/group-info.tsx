import UserAvatar from '@/components/UserAvatar';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { groupsAPI, usersAPI } from '@/services/api';
import { secureStorage } from '@/utils/secureStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import React, { useEffect, useState, useCallback } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Modal,
    ScrollView,
    Text,
    TextInput,
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
  avatar_url?: string;
  profile_image?: string;
}

export default function GroupInfoScreen() {
  const { id, groupData } = useLocalSearchParams();
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isAddingMembers, setIsAddingMembers] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [isAddMemberModalVisible, setIsAddMemberModalVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const { user } = useAuth();
  const { currentTheme } = useTheme();

  const isDark = currentTheme === 'dark';
  // Check if user is admin (handle both boolean true and number 1)
  const isAdmin = user?.is_admin === true || user?.is_admin === 1;
  const isOwner = groupInfo?.owner_id === user?.id;

  const loadGroupInfo = async () => {
    try {
      setIsLoading(true);
      
      // Try to use passed group data first (only on initial load)
      if (groupData && !groupInfo) {
        try {
          const parsedGroupData = JSON.parse(decodeURIComponent(groupData as string));
          setGroupInfo(parsedGroupData);
          setIsLoading(false);
          return;
        } catch {
          // If parsing fails, continue to fetch from API
          console.warn('Failed to parse groupData, fetching from API');
        }
      }

      // Fetch full group info from API (includes members)
      try {
        const response = await groupsAPI.getGroup(Number(id));
        const group = response.data;
        
        if (group) {
          setGroupInfo({
            id: group.id,
            name: group.name,
            description: group.description,
            owner_id: group.owner_id,
            created_at: group.created_at,
            updated_at: group.updated_at,
            avatar_url: group.avatar_url,
            users: group.users || group.members || [], // Get members from API
          });
        } else {
          Alert.alert('Error', 'Group not found');
        }
      } catch (apiError: any) {
        // Fallback: try to get from groups list if getGroup fails
        console.warn('getGroup failed, trying getAll as fallback:', apiError);
        const response = await groupsAPI.getAll();
        const group = response.data.find((g: any) => g.id === Number(id));
        
        if (group) {
          setGroupInfo({
            id: group.id,
            name: group.name,
            description: group.description,
            owner_id: group.owner_id,
            created_at: group.created_at,
            updated_at: group.updated_at,
            avatar_url: group.avatar_url,
            users: group.users || [], // May not have users from getAll()
          });
        } else {
          Alert.alert('Error', 'Group not found');
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, groupData]); // loadGroupInfo is stable, no need to include
  
  // Reload group info when screen comes into focus (to get updated avatar)
  useFocusEffect(
    useCallback(() => {
      loadGroupInfo();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]) // loadGroupInfo is stable, no need to include
  );
  
  useEffect(() => {
    if (groupInfo) {
      setEditName(groupInfo.name);
      setEditDescription(groupInfo.description || '');
    }
  }, [groupInfo]);
  
  useEffect(() => {
    if (groupInfo?.avatar_url) {
      // When avatar URL changes, bump the version to bypass cache
      setAvatarVersion(Date.now());
    }
  }, [groupInfo?.avatar_url]);
  
  const loadAvailableUsers = async () => {
    try {
      const response = await usersAPI.getAll();
      if (response.data) {
        // Filter out users who are already members of the group
        const existingMemberIds = groupInfo?.users.map(user => user.id) || [];
        const filteredUsers = response.data.filter((user: any) => 
          !existingMemberIds.includes(user.id)
        );
        setAvailableUsers(filteredUsers);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
      Alert.alert('Error', 'Failed to load available users');
    }
  };

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
  
  const handleUpdateGroup = async () => {
    if (!isAdmin && !isOwner) {
      Alert.alert('Permission Denied', 'Only administrators or group owners can edit group details.');
      return;
    }
    
    if (!editName.trim()) {
      Alert.alert('Error', 'Group name cannot be empty');
      return;
    }
    
    setIsUpdating(true);
    try {
      await groupsAPI.update(Number(id), {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
      });
      
      // Update local state
      if (groupInfo) {
        setGroupInfo({
          ...groupInfo,
          name: editName.trim(),
          description: editDescription.trim() || undefined,
        });
      }
      
      setIsEditModalVisible(false);
      Alert.alert('Success', 'Group information updated successfully!');
    } catch (error: any) {
      console.error('Failed to update group:', error);
      let errorMessage = 'Failed to update group information';
      
      if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setIsUpdating(false);
    }
  };
  
  const handleAddMembers = async () => {
    if (!isAdmin && !isOwner) {
      Alert.alert('Permission Denied', 'Only administrators or group owners can add members.');
      return;
    }
    
    if (selectedUsers.length === 0) {
      Alert.alert('Error', 'Please select at least one user to add');
      return;
    }
    
    setIsAddingMembers(true);
    try {
      const response = await groupsAPI.addMembers(Number(id), selectedUsers);
      
      // Close modal and clear selection first
      setIsAddMemberModalVisible(false);
      setSelectedUsers([]);
      
      // Check if response includes updated group data
      if (response.data?.group && response.data.group.users) {
        // Update state directly from response if available
        setGroupInfo({
          ...groupInfo!,
          users: response.data.group.users,
        });
      } else {
        // Otherwise, refresh from API
        await loadGroupInfo();
      }
      
      Alert.alert('Success', 'Members added successfully!');
    } catch (error: any) {
      console.error('Failed to add members:', error);
      let errorMessage = 'Failed to add members';
      
      if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setIsAddingMembers(false);
    }
  };
  
  const handlePickGroupAvatar = async () => {
    if (!isAdmin && !isOwner) {
      Alert.alert('Permission Denied', 'Only administrators or group owners can update group profile picture.');
      return;
    }

    try {
      // Request permission first
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert(
          'Permission Required',
          'Please grant access to your photo library to upload a group avatar.',
          [{ text: 'OK' }]
        );
        return;
      }

      // Show action sheet to choose source
      Alert.alert(
        'Change Group Avatar',
        'Choose an option',
        [
          {
            text: 'Camera',
            onPress: async () => {
              const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
              if (!cameraPermission.granted) {
                Alert.alert('Permission Required', 'Please grant camera access.');
                return;
              }
              await handleImagePicker(ImagePicker.launchCameraAsync);
            },
          },
          {
            text: 'Photo Library',
            onPress: async () => {
              await handleImagePicker(ImagePicker.launchImageLibraryAsync);
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
          },
        ],
        { cancelable: true }
      );
    } catch (error: any) {
      console.error('Avatar picker error:', error);
      Alert.alert('Error', 'Failed to open image picker');
    }
  };

  const handleImagePicker = async (pickerFunction: typeof ImagePicker.launchImageLibraryAsync) => {
    try {
      const result = await pickerFunction({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];

      // Check file size
      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
        Alert.alert('Error', 'Image file size must be less than 5MB');
        return;
      }

      setAvatarUploading(true);

      // Get authentication token
      const token = await secureStorage.getItem('auth_token');
      if (!token) {
        Alert.alert('Error', 'You must be logged in to upload a group avatar');
        setAvatarUploading(false);
        return;
      }

      // Create a stable file we can reference (manipulateAsync ensures a file:// URI)
      let fileUri = asset.uri;
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          asset.uri,
          [],
          {
            compress: 0.9,
            format: ImageManipulator.SaveFormat.JPEG,
          }
        );
        fileUri = manipulated.uri;
      } catch {
        // Fallback to original URI if manipulation fails
      }

      const originalFileName = asset.fileName || `group_avatar_${Date.now()}.jpg`;
      const extFromName = originalFileName.includes('.') ? originalFileName.split('.').pop() : undefined;
      const extension = extFromName?.replace(/\s/g, '')?.toLowerCase() || 'jpg';
      const sanitizedType = asset.type && asset.type.includes('/') ? asset.type : undefined;
      const mimeType = asset.mimeType || sanitizedType || (extension === 'png' ? 'image/png' : 'image/jpeg');
      const normalizedFileName = originalFileName.includes('.')
        ? originalFileName
        : `group_avatar_${Date.now()}.${extension === 'jpeg' ? 'jpg' : extension}`;

      // Build FormData payload
      const formData = new FormData();
      formData.append('avatar', {
        uri: fileUri,
        name: normalizedFileName,
        type: mimeType,
      } as any);

      await groupsAPI.uploadAvatar(Number(id), formData);
      
      // Reload group info to get the updated avatar_url from backend
      await loadGroupInfo();
      
      // Update avatar version for cache busting
      setAvatarVersion(Date.now());
      
      Alert.alert('Success', 'Group avatar updated successfully!');

    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || 'Failed to upload group avatar. Please try again.';
      Alert.alert('Upload Failed', errorMessage);
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleLeaveGroup = () => {
    // Don't allow owner to leave - they need to delete or transfer ownership
    if (isOwner) {
      Alert.alert(
        'Cannot Leave Group',
        'As the group owner, you cannot leave the group. You can either delete the group or transfer ownership to another member.',
        [{ text: 'OK' }]
      );
      return;
    }

    Alert.alert(
      'Leave Group',
      `Are you sure you want to leave "${groupInfo?.name}"? You will no longer receive messages from this group.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: confirmLeaveGroup,
        },
      ]
    );
  };

  const confirmLeaveGroup = async () => {
    setIsLeaving(true);
    try {
      await groupsAPI.leaveGroup(Number(id));
      Alert.alert(
        'Success',
        'You have left the group successfully!',
        [
          {
            text: 'OK',
            onPress: () => {
              // Navigate back to groups list
              router.replace('/groups');
            },
          },
        ]
      );
    } catch (error: any) {
      console.error('Failed to leave group:', error);
      let errorMessage = 'Failed to leave group';
      
      if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setIsLeaving(false);
    }
  };

  const handleRemoveMember = async (memberId: number) => {
    if (!isAdmin && !isOwner) {
      Alert.alert('Permission Denied', 'Only administrators or group owners can remove members.');
      return;
    }
    
    // Don't allow removing the owner
    if (memberId === groupInfo?.owner_id) {
      Alert.alert('Error', 'Cannot remove the group owner');
      return;
    }
    
    Alert.alert(
      'Remove Member',
      'Are you sure you want to remove this member from the group?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await groupsAPI.removeMembers(Number(id), [memberId]);
              
              // Update local state
              if (groupInfo) {
                setGroupInfo({
                  ...groupInfo,
                  users: groupInfo.users.filter(user => user.id !== memberId),
                });
              }
              
              Alert.alert('Success', 'Member removed successfully!');
            } catch (error: any) {
              console.error('Failed to remove member:', error);
              let errorMessage = 'Failed to remove member';
              
              if (error.response?.data?.message) {
                errorMessage = error.response.data.message;
              }
              
              Alert.alert('Error', errorMessage);
            }
          },
        },
      ]
    );
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
      {item.id === groupInfo?.owner_id ? (
        <View className="bg-yellow-100 dark:bg-yellow-900/20 px-2 py-1 rounded">
          <Text className="text-yellow-800 dark:text-yellow-200 text-xs font-medium">
            Owner
          </Text>
        </View>
      ) : (
        /* Remove Member Button (only shown to admins/owners and not for the owner) */
        (isAdmin || isOwner) && (
          <TouchableOpacity 
            onPress={() => handleRemoveMember(item.id)}
            className="bg-red-100 dark:bg-red-900/20 p-2 rounded"
          >
            <MaterialCommunityIcons name="account-remove" size={20} color="#EF4444" />
          </TouchableOpacity>
        )
      )}
    </View>
  );
  
  const renderAvailableUser = ({ item }: { item: any }) => (
    <TouchableOpacity 
      onPress={() => {
        if (selectedUsers.includes(item.id)) {
          setSelectedUsers(selectedUsers.filter(id => id !== item.id));
        } else {
          setSelectedUsers([...selectedUsers, item.id]);
        }
      }}
      className={`flex-row items-center p-4 border-b ${
        isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      } ${selectedUsers.includes(item.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
    >
      {/* User Avatar */}
      <View className="mr-4">
        <UserAvatar
          avatarUrl={item.avatar_url}
          name={item.name}
          size={40}
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

      {/* Selection Indicator */}
      <View className={`w-6 h-6 rounded-full border-2 ${
        selectedUsers.includes(item.id) 
          ? 'bg-blue-500 border-blue-500' 
          : isDark ? 'border-gray-600' : 'border-gray-300'
      } items-center justify-center`}>
        {selectedUsers.includes(item.id) && (
          <MaterialCommunityIcons name="check" size={16} color="#fff" />
        )}
      </View>
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
            <TouchableOpacity 
              onPress={handlePickGroupAvatar}
              disabled={avatarUploading || (!isAdmin && !isOwner)}
              className="relative"
            >
              {groupInfo.avatar_url ? (
                <View className="relative">
                  <Image
                    source={{
                      uri: `${groupInfo.avatar_url}${groupInfo.avatar_url.includes('?') ? '&' : '?'}v=${avatarVersion}`
                    }}
                    style={{ width: 80, height: 80, borderRadius: 40, marginRight: 16 }}
                  />
                  {(isAdmin || isOwner) && (
                    <View className="absolute bottom-0 right-0 bg-blue-500 rounded-full p-1">
                      <MaterialCommunityIcons name="camera" size={12} color="white" />
                    </View>
                  )}
                  {avatarUploading && (
                    <View className="absolute inset-0 bg-black/50 rounded-full items-center justify-center">
                      <ActivityIndicator size="small" color="#fff" />
                    </View>
                  )}
                </View>
              ) : (
                <View className="w-20 h-20 rounded-full bg-primary items-center justify-center mr-4 relative">
                  <Text className="text-white font-bold text-2xl">
                    {getGroupAvatarInitials(groupInfo.name)}
                  </Text>
                  {(isAdmin || isOwner) && (
                    <View className="absolute bottom-0 right-0 bg-blue-500 rounded-full p-1">
                      <MaterialCommunityIcons name="camera" size={12} color="white" />
                    </View>
                  )}
                  {avatarUploading && (
                    <View className="absolute inset-0 bg-black/50 rounded-full items-center justify-center">
                      <ActivityIndicator size="small" color="#fff" />
                    </View>
                  )}
                </View>
              )}
            </TouchableOpacity>

            {/* Group Info */}
            <View className="flex-1">
              <View className="flex-row items-center justify-between">
                <Text
                  className={`text-2xl font-bold mb-1 ${
                    isDark ? 'text-white' : 'text-gray-900'
                  }`}
                >
                  {groupInfo.name}
                </Text>
                
                {/* Edit button for admins/owners */}
                {(isAdmin || isOwner) && (
                  <TouchableOpacity 
                    onPress={() => {
                      setEditName(groupInfo.name);
                      setEditDescription(groupInfo.description || '');
                      setIsEditModalVisible(true);
                    }}
                    className="bg-blue-100 dark:bg-blue-900/20 p-2 rounded"
                  >
                    <MaterialCommunityIcons name="pencil" size={20} color="#3B82F6" />
                  </TouchableOpacity>
                )}
              </View>
              
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
          <View className="flex-row items-center justify-between mb-4">
            <Text
              className={`text-lg font-semibold ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
            >
              Members {groupInfo.users.length > 0 ? `(${groupInfo.users.length})` : ''}
            </Text>
            
            {/* Add Members Button for admins/owners */}
            {(isAdmin || isOwner) && (
              <TouchableOpacity 
                onPress={() => {
                  setSelectedUsers([]);
                  loadAvailableUsers();
                  setIsAddMemberModalVisible(true);
                }}
                className="bg-green-100 dark:bg-green-900/20 py-2 px-3 rounded-lg flex-row items-center"
              >
                <MaterialCommunityIcons name="account-plus" size={18} color="#10B981" />
                <Text className="text-green-700 dark:text-green-400 ml-1 font-medium">
                  Add
                </Text>
              </TouchableOpacity>
            )}
          </View>

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

        {/* Leave Group Section - Visible to all members except owner */}
        {!isOwner && (
          <View className="p-4 border-t border-gray-200 dark:border-gray-700">
            <TouchableOpacity
              onPress={handleLeaveGroup}
              disabled={isLeaving}
              className={`flex-row items-center p-4 rounded-lg ${
                isDark ? 'bg-orange-900/20' : 'bg-orange-50'
              }`}
            >
              <MaterialCommunityIcons
                name="exit-to-app"
                size={24}
                color="#F97316"
              />
              <Text className="ml-3 text-base text-orange-600 dark:text-orange-400 font-medium">
                {isLeaving ? 'Leaving...' : 'Leave Group'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

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
      
      {/* Edit Group Modal */}
      <Modal
        visible={isEditModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsEditModalVisible(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/50">
          <View className={`w-11/12 p-6 rounded-lg ${
            isDark ? 'bg-gray-800' : 'bg-white'
          }`}>
            <Text className={`text-lg font-bold mb-4 ${
              isDark ? 'text-white' : 'text-gray-900'
            }`}>
              Edit Group
            </Text>
            
            <Text className={`mb-1 font-medium ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Group Name
            </Text>
            <TextInput
              value={editName}
              onChangeText={setEditName}
              className={`border rounded-lg p-3 mb-4 ${
                isDark 
                  ? 'bg-gray-700 border-gray-600 text-white' 
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
              placeholder="Enter group name"
              placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
            />
            
            <Text className={`mb-1 font-medium ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Description (Optional)
            </Text>
            <TextInput
              value={editDescription}
              onChangeText={setEditDescription}
              className={`border rounded-lg p-3 mb-6 ${
                isDark 
                  ? 'bg-gray-700 border-gray-600 text-white' 
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
              placeholder="Enter group description"
              placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            
            <View className="flex-row justify-end">
              <TouchableOpacity
                onPress={() => setIsEditModalVisible(false)}
                className="px-4 py-2 mr-2"
              >
                <Text className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                  Cancel
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                onPress={handleUpdateGroup}
                disabled={isUpdating}
                className={`px-4 py-2 rounded-lg ${
                  isUpdating 
                    ? 'bg-blue-400' 
                    : 'bg-blue-500'
                }`}
              >
                {isUpdating ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text className="text-white font-medium">
                    Save
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      
      {/* Add Members Modal */}
      <Modal
        visible={isAddMemberModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsAddMemberModalVisible(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/50">
          <View className={`w-11/12 h-5/6 p-6 rounded-lg ${
            isDark ? 'bg-gray-800' : 'bg-white'
          }`}>
            <Text className={`text-lg font-bold mb-4 ${
              isDark ? 'text-white' : 'text-gray-900'
            }`}>
              Add Members
            </Text>
            
            {/* Search Box */}
            <View className={`flex-row items-center border rounded-lg p-2 mb-4 ${
              isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-300'
            }`}>
              <MaterialCommunityIcons 
                name="magnify" 
                size={20} 
                color={isDark ? '#9CA3AF' : '#6B7280'} 
                style={{ marginRight: 8 }}
              />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                className={isDark ? 'text-white flex-1' : 'text-gray-900 flex-1'}
                placeholder="Search users"
                placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
              />
            </View>
            
            {/* User List */}
            {availableUsers.length > 0 ? (
              <FlatList
                data={availableUsers.filter(user => 
                  user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  user.email.toLowerCase().includes(searchQuery.toLowerCase())
                )}
                renderItem={renderAvailableUser}
                keyExtractor={(item) => item.id.toString()}
                className="flex-1 mb-4"
              />
            ) : (
              <View className="flex-1 justify-center items-center">
                {isAddingMembers ? (
                  <ActivityIndicator size="large" color="#3B82F6" />
                ) : (
                  <Text className={isDark ? 'text-gray-400' : 'text-gray-600'}>
                    No users available to add
                  </Text>
                )}
              </View>
            )}
            
            {/* Action Buttons */}
            <View className="flex-row justify-end">
              <TouchableOpacity
                onPress={() => setIsAddMemberModalVisible(false)}
                className="px-4 py-2 mr-2"
              >
                <Text className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                  Cancel
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                onPress={handleAddMembers}
                disabled={isAddingMembers || selectedUsers.length === 0}
                className={`px-4 py-2 rounded-lg ${
                  isAddingMembers || selectedUsers.length === 0
                    ? 'bg-blue-400' 
                    : 'bg-blue-500'
                }`}
              >
                {isAddingMembers ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text className="text-white font-medium">
                    Add Selected ({selectedUsers.length})
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
} 