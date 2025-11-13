import ReplyBubble from '@/components/ReplyBubble';
import ReplyPreview from '@/components/ReplyPreview';
import UserAvatar from '@/components/UserAvatar';
import GroupAvatar from '@/components/GroupAvatar';
import VoiceMessageBubble from '@/components/VoiceMessageBubble';
import VoicePlayer from '@/components/VoicePlayer';
import VoiceRecorder from '@/components/VoiceRecorder';
import LinkText from '@/components/LinkText';
import VideoPlayer from '@/components/VideoPlayer';
import { isVideoAttachment } from '@/utils/textUtils';
import { AppConfig } from '@/config/app.config';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useTheme } from '@/context/ThemeContext';
import { groupsAPI, messagesAPI, usersAPI } from '@/services/api';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Picker } from 'emoji-mart-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Message {
  id: number;
  message: string;
  sender_id: number;
  group_id: number;
  created_at: string;
  read_at?: string | null;
  attachments?: {
    id: number;
    name: string;
    mime: string;
    url: string;
    path?: string;
    uri?: string;
    size?: number;
    type?: string;
    isImage?: boolean;
  }[];
  voice_message?: {
    url: string;
    duration: number;
  };
  sender?: {
    id: number;
    name: string;
    avatar_url?: string;
  };
  reply_to?: {
    id: number;
    message: string;
    sender: {
      id: number;
      name: string;
      avatar_url?: string;
    };
    attachments?: {
      id: number;
      name: string;
      mime: string;
      url: string;
    }[];
    created_at: string;
  };
  reply_to_id?: number;
}

interface Attachment {
  uri: string;
  name: string;
  type: string;
  isImage?: boolean;
}

// Helper function to get base URL without /api suffix
const getBaseUrl = () => {
  if (__DEV__) {
    // For Android devices (both physical and emulator in Expo Go), use the physical device URL
    // This is because Expo Go on physical devices needs your computer's network IP
    if (Platform.OS === 'android') {
      return AppConfig.api.development.physical.replace('/api', '');
    } else if (Platform.OS === 'ios') {
      return AppConfig.api.development.ios.replace('/api', '');
    } else {
      return AppConfig.api.development.physical.replace('/api', '');
    }
  }
  return AppConfig.api.production.replace('/api', '');
};

export default function GroupChatScreen() {
  const { id } = useLocalSearchParams();
  const { currentTheme } = useTheme();
  const { user } = useAuth();
  const { updateUnreadCount, setActiveConversation, clearActiveConversation } = useNotifications();
  const insets = useSafeAreaInsets();
  const ENABLE_MARK_AS_READ = true; // Enable mark as read functionality for groups
  const ENABLE_DELETE_MESSAGE = true; // Enable delete - route exists
  // Remove the navigation effect - let the AppLayout handle authentication state changes
  const isDark = currentTheme === 'dark';

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [showGroupMembers, setShowGroupMembers] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState<{ uri: string; duration: number } | null>(null);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [showImagePreview, setShowImagePreview] = useState<string | null>(null);
  const [showMessageOptions, setShowMessageOptions] = useState<number | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const flatListRef = useRef<FlatList>(null);
  const hasScrolledForThisConversation = useRef<string | null>(null); // Track which conversation we've scrolled for
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastScrollTrigger, setLastScrollTrigger] = useState(0);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

  // Fetch messages
  const fetchMessages = async () => {
    try {
      setLoading(true);
      setHasScrolledToBottom(false); // Reset scroll flag when fetching new messages
      const response = await messagesAPI.getByGroup(Number(id), 1, 10);
      // Handle Laravel pagination format
      const messagesData = response.data.messages?.data || response.data.messages || [];
      const pagination = response.data.messages || {};
      
      // Check if there are more messages using Laravel pagination
      setHasMoreMessages(pagination.current_page < pagination.last_page);
      
      // Process messages to ensure reply_to data is properly structured
      // If a message has reply_to_id but no reply_to object, we need to find the original message
      const processedMessages = messagesData.map((msg: any) => {
        // If message already has reply_to object, use it
        if (msg.reply_to) {
          return msg;
        }
        
        // If message has reply_to_id but no reply_to object, try to find it in the messages list
        if (msg.reply_to_id) {
          const repliedMessage = messagesData.find((m: any) => m.id === msg.reply_to_id);
          if (repliedMessage) {
            // Construct reply_to object from the found message
            msg.reply_to = {
              id: repliedMessage.id,
              message: repliedMessage.message,
              sender: repliedMessage.sender || {
                id: repliedMessage.sender_id,
                name: repliedMessage.sender?.name || 'Unknown User'
              },
              attachments: repliedMessage.attachments || []
            };
          }
        }
        
        return msg;
      });
      
      // Sort messages by created_at in ascending order (oldest first)
      const sortedMessages = processedMessages.sort((a: Message, b: Message) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      setMessages(sortedMessages);
      setGroupInfo(response.data.selectedConversation);
      
      // Set loading to false - scroll will happen after content is rendered
      setLoading(false);
      
      // Reset scroll flag to allow initial scroll
      setHasScrolledToBottom(false);
      
      // Mark messages as read when user opens group conversation
      const groupId = Number(id);
      if (ENABLE_MARK_AS_READ) {
        try {
          await groupsAPI.markMessagesAsRead(groupId);
          // Update unread count to 0 for this group - this will update badge
          updateUnreadCount(groupId, 0);
        } catch (error: any) {
          // Handle errors gracefully - don't show to user
          const statusCode = error?.response?.status;
          
          // 429 = Too Many Requests (rate limit) - expected, handled gracefully
          // 422 = Validation error - expected in some cases
          // 404 = Not found - endpoint might not exist yet
          // Only log unexpected errors in development
          if (statusCode !== 429 && statusCode !== 422 && statusCode !== 404) {
            if (__DEV__) {
              console.log('markMessagesAsRead failed for group:', statusCode || error?.message || error);
            }
          }
          // Silently ignore rate limit and validation errors
        }
      }
      
      // Scroll will be handled by useEffect and onContentSizeChange after images render
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      Alert.alert('Error', 'Failed to load messages');
      setLoading(false);
    }
  };

  // Simple approach: Scroll to bottom ONCE when messages are first loaded for this conversation
  useEffect(() => {
    // Only scroll if:
    // 1. Not loading
    // 2. We have messages
    // 3. We haven't scrolled for this conversation yet
    if (!loading && messages.length > 0 && hasScrolledForThisConversation.current !== id) {
      // Mark that we've scrolled for this conversation
      hasScrolledForThisConversation.current = id as string;
      
      // Wait for layout to be ready, then scroll once
      const timeoutId = setTimeout(() => {
        if (flatListRef.current && messages.length > 0) {
          try {
            // Try scrollToEnd first
            flatListRef.current.scrollToEnd({ animated: false });
            setHasScrolledToBottom(true);
            console.log('Scrolled to bottom on initial load');
          } catch (error) {
            // Fallback: scroll to last index
            try {
              const lastIndex = messages.length - 1;
              if (lastIndex >= 0) {
                flatListRef.current.scrollToIndex({ 
                  index: lastIndex, 
                  animated: false,
                  viewPosition: 1
                });
                setHasScrolledToBottom(true);
                console.log('Scrolled to bottom via scrollToIndex');
              }
            } catch (scrollError) {
              console.warn('Scroll failed:', scrollError);
            }
          }
        }
      }, 600); // Single delay - wait for content to render
      
      return () => clearTimeout(timeoutId);
    }
  }, [loading, messages.length, id]); // Only depend on loading, messages, and conversation id

  // Mark messages as read when group chat is opened
  useFocusEffect(
    useCallback(() => {
      // Set this conversation as active to suppress notifications
      const conversationId = Number(id);
      if (conversationId) {
        setActiveConversation(conversationId);
      }

      const markGroupMessagesAsRead = async () => {
        if (!ENABLE_MARK_AS_READ || !id || !user) return;
        
        try {
          // Mark all unread messages in this group as read
          await groupsAPI.markMessagesAsRead(Number(id));
          
          // Update unread count to 0 for this group
          updateUnreadCount(Number(id), 0);
          
          if (__DEV__) {
            console.log('Group messages marked as read');
          }
        } catch (error: any) {
          // Handle errors gracefully - don't show to user
          const statusCode = error?.response?.status;
          
          // 429 = Too Many Requests (rate limit) - expected, handled gracefully
          // 422 = Validation error - expected in some cases
          // 404 = Not found - endpoint might not exist yet
          // Only log unexpected errors in development
          if (statusCode !== 429 && statusCode !== 422 && statusCode !== 404) {
            if (__DEV__) {
              console.error('Error marking group messages as read:', statusCode || error?.message || error);
            }
          }
          // Silently ignore rate limit and validation errors
        }
      };

      // Small delay to ensure screen is fully loaded
      const timer = setTimeout(() => {
        markGroupMessagesAsRead();
      }, 300);

      return () => {
        clearTimeout(timer);
        // Clear active conversation when screen loses focus
        clearActiveConversation();
      };
    }, [id, user, ENABLE_MARK_AS_READ, updateUnreadCount, setActiveConversation, clearActiveConversation])
  );

  // Load more messages function
  const loadMoreMessages = async () => {
    if (loadingMore || !hasMoreMessages) return;
    
    setLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const response = await messagesAPI.getByGroup(Number(id), nextPage, 10);
      
      // Handle Laravel pagination format
      const newMessagesData = response.data.messages?.data || response.data.messages || [];
      const pagination = response.data.messages || {};
      
      if (newMessagesData.length === 0) {
        setHasMoreMessages(false);
        return;
      }
      
      // Process messages to ensure reply_to data is properly structured
      const processedNewMessages = newMessagesData.map((msg: any) => {
        // If message already has reply_to object, use it
        if (msg.reply_to) {
          return msg;
        }
        return msg;
      });
      
      // Sort new messages by created_at in ascending order (oldest first)
      const sortedNewMessages = processedNewMessages.sort((a: Message, b: Message) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      
      // Prepend new messages to existing messages (older messages go at the beginning)
      // Also process all messages to ensure reply_to references are resolved
      setMessages(prev => {
        const allMessages = [...sortedNewMessages, ...prev];
        // Process all messages to resolve reply_to references
        return allMessages.map((msg: any) => {
          // If message has reply_to_id but no reply_to object, find it in all messages
          if (msg.reply_to_id && !msg.reply_to) {
            const repliedMessage = allMessages.find((m: any) => m.id === msg.reply_to_id);
            if (repliedMessage) {
              msg.reply_to = {
                id: repliedMessage.id,
                message: repliedMessage.message,
                sender: repliedMessage.sender || {
                  id: repliedMessage.sender_id,
                  name: repliedMessage.sender?.name || 'Unknown User'
                },
                attachments: repliedMessage.attachments || []
              };
            }
          }
          return msg;
        });
      });
      setCurrentPage(nextPage);
      
      // Check if there are more messages using Laravel pagination
      setHasMoreMessages(pagination.current_page < pagination.last_page);
      
    } catch (error) {
      console.error('Error loading more messages:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  // Keyboard listeners
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const keyboardDidHideListener = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      keyboardDidShowListener?.remove();
      keyboardDidHideListener?.remove();
    };
  }, []);

  // Reset keyboard height when component unmounts or when leaving screen
  useEffect(() => {
    return () => {
      setKeyboardHeight(0);
    };
  }, []);

  // Handle mobile hardware back button
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        // Navigate directly to groups tab
        router.replace('/groups');
        return true; // Prevent default back behavior
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [])
  );

  // Send message
  const handleSend = async () => {
    // Don't send if there's no content at all
    if (!input.trim() && !attachment && !voiceRecording) return;
    
    setSending(true);
    try {
      let formData = new FormData();
      
      // Handle file/image attachment
      let messageText = input.trim();
      
      // If attachment exists and no text, add marker similar to voice messages
      if (attachment && !messageText) {
        if (attachment.type?.startsWith('image/') || attachment.isImage) {
          messageText = '[IMAGE]';
        } else {
          messageText = '[FILE]';
        }
      }
      
      formData.append('group_id', id as string);
      
      // Add reply_to_id if replying to a message
      if (replyingTo) {
        formData.append('reply_to_id', replyingTo.id.toString());
      }
      
      // Handle file/image attachment
      if (attachment) {
        formData.append('attachments[]', {
          uri: attachment.uri,
          name: attachment.name,
          type: attachment.type,
        } as any);
      }
      
      // Add text message if present (or marker for attachment)
      if (messageText && !voiceRecording) {
        formData.append('message', messageText);
      }
      
      // Handle voice recording - attach file + keep marker text
      if (voiceRecording) {
        const voiceMessage = `[VOICE_MESSAGE:${voiceRecording.duration}]`;
        const combinedMessage = messageText ? `${messageText} ${voiceMessage}` : voiceMessage;
        formData.append('message', combinedMessage);

        // Important: send as attachments[] so Laravel sees an array
        formData.append('attachments[]', {
          uri: voiceRecording.uri,
          name: 'voice_message.m4a',
          type: 'audio/m4a',
        } as any);

        // Optional metadata
        formData.append('voice_duration', voiceRecording.duration.toString());
        formData.append('is_voice_message', 'true');
      }
      
      const res = await messagesAPI.sendMessage(formData);
      
      // Update last_seen_at when user sends a message (activity indicator)
      try {
        await usersAPI.updateLastSeen();
      } catch {
        // Silently fail - don't block message sending if last_seen update fails
        // Failed to update last_seen_at
      }
      
      // Prepare message text to preserve what was sent
      let messageTextToPreserve = input.trim();
      if (voiceRecording) {
        messageTextToPreserve = input.trim() ? `${input.trim()} [VOICE_MESSAGE:${voiceRecording.duration}]` : `[VOICE_MESSAGE:${voiceRecording.duration}]`;
      } else if (attachment && !input.trim()) {
        // Add marker for attachment without text
        messageTextToPreserve = attachment.type?.startsWith('image/') || attachment.isImage ? '[IMAGE]' : '[FILE]';
      }
      
      // Ensure the message has sender_id set correctly from backend response
      // Also preserve reply_to data if it exists in response or from replyingTo state
      const newMessage = {
        ...res.data,
        message: res.data.message || messageTextToPreserve, // Preserve message text
        sender_id: res.data.sender_id || Number(user?.id), // Ensure sender_id is set
        group_id: res.data.group_id || Number(id), // Ensure group_id is set
        sender: res.data.sender || {
          id: Number(user?.id),
          name: user?.name,
          avatar_url: user?.avatar_url
        },
        // Preserve reply_to from backend response, or construct from replyingTo state
        reply_to: res.data.reply_to || (replyingTo ? {
          id: replyingTo.id,
          message: replyingTo.message,
          sender: replyingTo.sender || {
            id: replyingTo.sender_id,
            name: replyingTo.sender?.name || 'Unknown User'
          },
          attachments: replyingTo.attachments || []
        } : undefined)
      };
      
      
      setMessages(prev => {
        // Check if message already exists to prevent duplicates
        const messageExists = prev.some(msg => msg.id === newMessage.id);
        if (messageExists) {
          return prev;
        }
        const updatedMessages = [...prev, newMessage];
        
        // Scroll to bottom after message is added to state
        // Use requestAnimationFrame and setTimeout to ensure state update is reflected
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (flatListRef.current) {
              try {
                flatListRef.current.scrollToEnd({ animated: true });
              } catch {
                // If scrollToEnd fails, try scrolling to the last item by index
                // Scroll failed, trying alternative method
                try {
                  // Wait for layout to complete, then scroll to last index
                  setTimeout(() => {
                    if (flatListRef.current) {
                      const lastIndex = updatedMessages.length - 1;
                      flatListRef.current.scrollToIndex({ 
                        index: lastIndex, 
                        animated: true,
                        viewPosition: 1 // 1 means bottom (0 = top, 1 = bottom)
                      });
                    }
                  }, 100);
                } catch {
                  // Alternative scroll method also failed
                }
              }
            }
          }, (attachment || voiceRecording) ? 300 : 100);
        });
        
        // Also scroll after content size changes (for images/files)
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (flatListRef.current) {
              try {
                flatListRef.current.scrollToEnd({ animated: true });
              } catch {
                // Second scroll attempt failed
              }
            }
          }, (attachment || voiceRecording) ? 400 : 200);
        });
        
        return updatedMessages;
      });
      setInput('');
      setAttachment(null);
      setVoiceRecording(null);
      setReplyingTo(null); // Clear reply state
      setShowEmoji(false);
    } catch (e: unknown) {
      const error = e as any;
      // Error sending message
      // Handle specific database constraint errors
      if (error.response?.data?.exception === 'Illuminate\\Database\\QueryException') {
        // If it's a voice message with database constraint error, still show the message
        if (voiceRecording) {
          // Don't show error alert, just log it
        } else {
          Alert.alert(
            'Error Sending Message',
            'There was a problem saving your message. This might be due to a database constraint issue. Please try again.',
            [{ text: 'OK' }]
          );
        }
      } else {
        Alert.alert('Error', 'Failed to send message. Please try again.');
      }
    } finally {
      setSending(false);
    }
  };

  // Pick image
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      const guessedName = asset.fileName || `photo_${Date.now()}.jpg`;
      const guessedMime = (asset as any).mimeType || 'image/jpeg';
      setAttachment({
        uri: asset.uri,
        name: guessedName,
        type: guessedMime,
        isImage: true,
      });
    }
  };

  // Pick any file
  const pickFile = async () => {
    try {
      const result: any = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: '*/*',
      });
      
      if (result?.type === 'success') {
        const mime = result.mimeType || 'application/octet-stream';
        setAttachment({
          uri: result.uri,
          name: result.name || `file_${Date.now()}`,
          type: mime,
          isImage: mime.startsWith('image/'),
        });
        return;
      }

      if (result?.canceled === false && Array.isArray(result.assets) && result.assets.length > 0) {
        const asset = result.assets[0];
        const mime = asset.mimeType || asset.type || 'application/octet-stream';
        setAttachment({
          uri: asset.uri,
          name: asset.name || asset.fileName || `file_${Date.now()}`,
          type: mime,
          isImage: mime.startsWith('image/'),
        });
        return;
      }
    } catch (e) {
      console.error('group pickFile error:', e);
    }
  };

  // Handle voice recording
  const handleVoiceRecording = () => {
    setShowVoiceRecorder(true);
  };

  // Handle voice recording completion
  const handleVoiceRecordingComplete = (uri: string, duration: number) => {
    setVoiceRecording({ uri, duration });
    setShowVoiceRecorder(false);
  };

  // Handle voice recording cancel
  const handleVoiceRecordingCancel = () => {
    setShowVoiceRecorder(false);
  };

  // Handle reply to message
  const handleReply = (message: any) => {
    setReplyingTo(message);
    setShowMessageOptions(null);
  };

  // Handle cancel reply
  const handleCancelReply = () => {
    setReplyingTo(null);
  };

  // Handle delete message
  const handleDeleteMessage = async (messageId: number) => {
    if (!ENABLE_DELETE_MESSAGE) {
      Alert.alert('Coming Soon', 'Message deletion will be available in a future update.');
      setShowMessageOptions(null);
      return;
    }

    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await messagesAPI.deleteMessage(messageId);
              
              // Remove message from local state
              setMessages(prev => prev.filter(msg => msg.id !== messageId));
              setShowMessageOptions(null);
              
              // Optionally refresh messages to get updated last_message
              // You can add this if needed
            } catch (error: any) {
              // Error deleting message
              
              // Handle different error types
              if (error?.response?.status === 404) {
                // Message not found - might have been deleted already
                Alert.alert(
                  'Message Not Found', 
                  'This message may have already been deleted.',
                  [{ text: 'OK', onPress: () => {
                    // Remove from local state anyway
                    setMessages(prev => prev.filter(msg => msg.id !== messageId));
                    setShowMessageOptions(null);
                  }}]
                );
              } else if (error?.response?.status === 403) {
                // Forbidden - user doesn't own this message
                Alert.alert('Permission Denied', 'You can only delete your own messages.');
              } else {
                Alert.alert('Error', 'Failed to delete message. Please try again.');
              }
              setShowMessageOptions(null);
            }
          }
        }
      ]
    );
  };

  // Handle long press on message
  const handleMessageLongPress = (message: any) => {
    // Show options for any message (reply for others, delete for own)
    setShowMessageOptions(message.id);
  };

  // Handle group header press
  const handleGroupHeaderPress = () => {
    setShowGroupMembers(!showGroupMembers);
  };

  // Render message bubble
  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    // Ensure sender_id and user.id are compared as numbers
    const senderId = Number(item.sender_id);
    const currentUserId = Number(user?.id);
    const isMine = senderId === currentUserId && senderId !== 0;
    const previousMessage = index > 0 ? messages[index - 1] : null;
    const showDateSeparator = shouldShowDateSeparator(item, previousMessage);
    
    const timestamp = formatMessageTime(item.created_at);

    // Check if this is a voice message (has audio attachment and voice data in message)
    let voiceMessageData = null;
    let isVoiceMessage = false;
    let messageText = null;
    
    // Helper function to clean message text by removing markers
    const cleanMessageText = (text: string | null | undefined): string | null => {
      if (!text) return null;
      // Remove [IMAGE] and [FILE] markers at the end, but preserve other text
      let cleaned = text.replace(/\s*\[IMAGE\]$/g, '').replace(/\s*\[FILE\]$/g, '').trim();
      // If after cleaning we have content, return it; otherwise return original if it had content
      return cleaned || (text.trim() ? text.trim() : null);
    };
    
    // Check for voice message format first (even without attachments)
    if (item.message && item.message.match(/\[VOICE_MESSAGE:(\d+)\]$/)) {
      const voiceMatch = item.message.match(/\[VOICE_MESSAGE:(\d+)\]$/);
      
      // This is a voice message - ALWAYS render as voice bubble regardless of attachments
      if (!voiceMatch) return null; // Safety check
      const duration = parseInt(voiceMatch[1]);
      
      // Try to find audio attachment
      let audioAttachment = null;
      if (item.attachments && item.attachments.length > 0) {
        audioAttachment = item.attachments.find(att => att.mime?.startsWith('audio/'));
      }
      
      // Extract text part (everything before the voice message format)
      const textPart = item.message.replace(/\[VOICE_MESSAGE:\d+\]$/, '').trim();
      
      // Construct full URL for audio attachment
      let audioUrl = null;
      if (audioAttachment?.url) {
        if (audioAttachment.url.startsWith('http')) {
          audioUrl = audioAttachment.url;
        } else {
          const cleanUrl = audioAttachment.url.startsWith('/') ? audioAttachment.url.substring(1) : audioAttachment.url;
          audioUrl = `${getBaseUrl()}/${cleanUrl}`;
        }
      }
      
      voiceMessageData = {
        url: audioUrl,
        duration: duration,
        textPart: textPart // Store the text part for display
      };
      isVoiceMessage = true;
    } else if (item.attachments && item.attachments.length > 0) {
      const audioAttachment = item.attachments.find(att => att.mime?.startsWith('audio/'));
      if (audioAttachment && item.message) {
        // Check for voice message format: [VOICE_MESSAGE:duration]
        const voiceMatch = item.message.match(/^\[VOICE_MESSAGE:(\d+)\]$/);
        if (voiceMatch) {
          voiceMessageData = {
            url: audioAttachment.url,
            duration: parseInt(voiceMatch[1])
          };
          isVoiceMessage = true;
        } else {
          // Regular message with audio attachment - clean the text
          messageText = cleanMessageText(item.message);
        }
      } else {
        // For image/file attachments, check if message is ONLY [IMAGE] or [FILE]
        // If so, don't display any text - only show the attachment
        if (item.message) {
          const trimmedMessage = item.message.trim();
          // If message is ONLY [IMAGE] or [FILE] (no other text), don't display it
          if (trimmedMessage === '[IMAGE]' || trimmedMessage === '[FILE]') {
            messageText = null; // Don't show the marker as text
          } else {
            // If message has text before the marker, remove the marker and show the text
            messageText = cleanMessageText(item.message);
          }
        } else {
          messageText = null;
        }
      }
    } else {
      // Regular text message with no attachments - show the message text directly
      // Only clean [IMAGE] and [FILE] markers if they're at the end
      if (item.message) {
        let text = item.message.trim();
        // Remove [IMAGE] and [FILE] markers only if they're standalone at the end
        if (text === '[IMAGE]' || text === '[FILE]') {
          // Don't show anything if it's just a marker with no other content
          messageText = null;
        } else if (text.endsWith('[IMAGE]') || text.endsWith('[FILE]')) {
          // Remove marker but keep the text before it
          messageText = text.replace(/\s*\[IMAGE\]$/g, '').replace(/\s*\[FILE\]$/g, '').trim();
        } else {
          // Show the full message text
          messageText = text;
        }
      } else {
        messageText = null;
      }
    }

    // If it's a voice message, render the dedicated voice bubble
    if (isVoiceMessage && voiceMessageData) {
      
      // If no URL is available, show a placeholder or fallback
      if (!voiceMessageData.url) {
        return (
          <View>
            {/* Date Separator */}
            {showDateSeparator && (
              <View style={{
                alignItems: 'center',
                marginVertical: 16,
                marginHorizontal: 16,
              }}>
                <View style={{
                  backgroundColor: isDark ? '#374151' : '#E5E7EB',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 12,
                }}>
                  <Text style={{
                    color: isDark ? '#9CA3AF' : '#6B7280',
                    fontSize: 12,
                    fontWeight: '500',
                  }}>
                    {formatMessageDate(item.created_at)}
                  </Text>
                </View>
              </View>
            )}
            
            <View style={{ 
              flexDirection: 'row', 
              alignItems: 'flex-end',
              marginVertical: 4,
              justifyContent: isMine ? 'flex-end' : 'flex-start'
            }}>
              {/* Avatar for received messages */}
              {!isMine && (
                <UserAvatar
                  avatarUrl={item.sender?.avatar_url}
                  name={item.sender?.name || 'User'}
                  size={32}
                  style={{ marginRight: 8, marginBottom: 4 }}
                />
              )}
              
              <TouchableOpacity
                onLongPress={() => handleMessageLongPress(item)}
                activeOpacity={0.8}
              >
                <View
                  style={{
                    backgroundColor: isMine ? '#25D366' : (isDark ? '#374151' : '#E5E7EB'),
                    borderRadius: 18,
                    borderTopLeftRadius: isMine ? 18 : 4,
                    borderTopRightRadius: isMine ? 4 : 18,
                    padding: 12,
                    maxWidth: '90%',
                    minWidth: 60,
                    alignSelf: isMine ? 'flex-end' : 'flex-start',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.1,
                    shadowRadius: 2,
                    elevation: 1,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <MaterialCommunityIcons 
                      name="microphone" 
                      size={20} 
                      color={isMine ? '#fff' : (isDark ? '#fff' : '#111827')} 
                    />
                    <Text style={{ 
                      marginLeft: 8,
                      color: isMine ? '#fff' : (isDark ? '#fff' : '#111827'),
                      fontSize: 16,
                    }}>
                      Voice Message ({voiceMessageData.duration}s)
                    </Text>
                  </View>
                  <Text style={{ fontSize: 10, color: isMine ? '#E0E7FF' : '#6B7280', marginTop: 2, alignSelf: 'flex-end' }}>
                    {timestamp}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        );
      }
      
      return (
        <TouchableOpacity
          onLongPress={() => handleMessageLongPress(item)}
          activeOpacity={0.8}
        >
          <VoiceMessageBubble
            uri={voiceMessageData.url}
            duration={voiceMessageData.duration}
            isMine={isMine}
            timestamp={timestamp}
            senderName={!isMine && item.sender ? item.sender.name : undefined}
            textPart={voiceMessageData.textPart}
          />
        </TouchableOpacity>
      );
    }

    // Regular message bubble
    return (
      <View>
        {/* Date Separator */}
        {showDateSeparator && (
          <View style={{
            alignItems: 'center',
            marginVertical: 16,
            marginHorizontal: 16,
          }}>
            <View style={{
              backgroundColor: isDark ? '#374151' : '#E5E7EB',
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 12,
            }}>
              <Text style={{
                color: isDark ? '#9CA3AF' : '#6B7280',
                fontSize: 12,
                fontWeight: '500',
              }}>
                {formatMessageDate(item.created_at)}
              </Text>
            </View>
          </View>
        )}
        
        <View style={{ 
          flexDirection: 'row', 
          alignItems: 'flex-end',
          marginVertical: 4,
          justifyContent: isMine ? 'flex-end' : 'flex-start'
        }}>
        {/* Avatar for received messages */}
        {!isMine && (
          <UserAvatar
            avatarUrl={item.sender?.avatar_url}
            name={item.sender?.name || 'User'}
            size={32}
            style={{ marginRight: 8, marginBottom: 4 }}
          />
        )}
        
        <TouchableOpacity
          onLongPress={() => handleMessageLongPress(item)}
          activeOpacity={0.8}
        >
          <View
            style={{
              backgroundColor: isMine ? '#25D366' : (isDark ? '#374151' : '#E5E7EB'),
              borderRadius: 18,
              borderTopLeftRadius: isMine ? 18 : 4,
              borderTopRightRadius: isMine ? 4 : 18,
              padding: 12,
              maxWidth: isMine ? '85%' : '75%', // Wider for sent messages to use more space
              minWidth: 120, // Increased minimum width for short messages
              alignSelf: isMine ? 'flex-end' : 'flex-start', // This ensures proper alignment
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.1,
              shadowRadius: 2,
              elevation: 1,
            }}
          >
          {/* Reply bubble */}
          {item.reply_to && (
            <ReplyBubble
              replyTo={item.reply_to}
              isMyMessage={isMine}
            />
          )}

          {/* Show sender name for group messages */}
          {!isMine && item.sender && (
            <Text
              style={{
                fontSize: 12,
                color: isMine ? '#E0E7FF' : '#6B7280',
                marginBottom: 4,
                fontWeight: '600',
              }}
            >
              {item.sender.name}
            </Text>
          )}

          {item.attachments && item.attachments.length > 0 && (() => {
            const firstAttachment = item.attachments[0];
            if (!firstAttachment) return null;
            
            return isVideoAttachment(firstAttachment) ? (
              <View style={{ width: '100%' }}>
                <VideoPlayer
                  url={(() => {
                    let url = firstAttachment.url || firstAttachment.path || firstAttachment.uri || '';
                    if (url && !url.startsWith('http')) {
                      const cleanUrl = url.startsWith('/') ? url.substring(1) : url;
                      url = `${getBaseUrl()}/${cleanUrl}`;
                    }
                    return url || '';
                  })()}
                  isMine={isMine}
                  isDark={isDark}
                  style={{ marginBottom: 4 }}
                />
                {/* Timestamp below video */}
                <Text style={{ 
                  fontSize: 10, 
                  color: isMine ? '#E0E7FF' : '#6B7280',
                  alignSelf: 'flex-end',
                  marginTop: 2,
                  marginRight: 2,
                }}>{timestamp}</Text>
              </View>
            ) : firstAttachment.mime?.startsWith('image/') ? (
              <View style={{ width: '100%' }}>
                <TouchableOpacity 
                  onPress={() => {
                    // Try multiple possible URL fields and construct full URL
                    let imageUrl = firstAttachment.url || 
                                  firstAttachment.path || 
                                  firstAttachment.uri;
                    
                    // If URL is relative, make it absolute
                    if (imageUrl && !imageUrl.startsWith('http')) {
                      const cleanUrl = imageUrl.startsWith('/') ? imageUrl.substring(1) : imageUrl;
                      imageUrl = `${getBaseUrl()}/${cleanUrl}`;
                    }
                    
                    if (imageUrl) {
                      setShowImagePreview(imageUrl);
                    }
                  }}
                >
                  <Image 
                    source={{ 
                      uri: (() => {
                        let url = firstAttachment.url || firstAttachment.path || firstAttachment.uri;
                        
                        if (url && !url.startsWith('http')) {
                          // Remove leading slash if present and construct full URL
                          const cleanUrl = url.startsWith('/') ? url.substring(1) : url;
                          const fullUrl = `${getBaseUrl()}/${cleanUrl}`;
                          return fullUrl;
                        }
                        return url;
                      })()
                    }} 
                    style={{ 
                      width: 200, 
                      height: 200, 
                      borderRadius: 12,
                      backgroundColor: isDark ? '#374151' : '#F3F4F6',
                      alignSelf: 'flex-start', // Prevent overflow
                      maxWidth: '100%',         // Ensure it doesn't overflow
                    }}
                    resizeMode="cover"
                    onError={(error) => {
                      // Silent fail for image loading
                    }}
                    onLoad={() => {
                      // Image loaded successfully
                    }}
                  />
                </TouchableOpacity>
                
                {/* Timestamp below image */}
                <Text style={{ 
                  fontSize: 10, 
                  color: isMine ? '#E0E7FF' : '#6B7280',
                  alignSelf: 'flex-end',
                  marginTop: 2,
                  marginRight: 2,
                }}>{timestamp}</Text>
              </View>
            ) : (
              <View style={{ width: '100%', overflow: 'hidden' }}>
                <View style={{ 
                  flexDirection: 'row', 
                  alignItems: 'flex-start',
                  width: '100%',
                  marginBottom: 4,
                }}>
                  {/* File icon - Left */}
                  <View style={{ 
                    width: 48,
                    height: 48,
                    borderRadius: 8,
                    backgroundColor: isMine 
                      ? (isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.2)')
                      : (isDark ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.1)'),
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginRight: 12,
                    flexShrink: 0,
                  }}>
                    <MaterialCommunityIcons 
                      name="file-document-outline" 
                      size={24} 
                      color={isMine ? '#fff' : (isDark ? '#fff' : '#111827')} 
                    />
                  </View>
                  
                  {/* File info container - Middle (takes most space) */}
                  <TouchableOpacity 
                    style={{ flex: 1, minWidth: 0, flexShrink: 1 }}
                    onPress={async () => {
                      const fileUrl = firstAttachment.url || firstAttachment.path || firstAttachment.uri;
                      let downloadUrl = fileUrl;
                      if (fileUrl && !fileUrl.startsWith('http')) {
                        const cleanUrl = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
                        downloadUrl = `${getBaseUrl()}/${cleanUrl}`;
                      }
                      
                      const fileName = firstAttachment.name || 'download';
                      
                      Alert.alert('File Download', `File: ${fileName}\nURL: ${downloadUrl}`, [
                        { text: 'OK', style: 'default' }
                      ]);
                    }}
                  >
                    {/* First row: File name */}
                    <Text 
                      style={{ 
                        color: isMine ? '#fff' : (isDark ? '#fff' : '#111827'),
                        fontSize: 14,
                        fontWeight: '500',
                        marginBottom: 4,
                      }}
                      numberOfLines={3}
                      ellipsizeMode="tail"
                    >
                      {firstAttachment.name}
                    </Text>
                    {/* Second row: File details with download icon */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                      <Text 
                        style={{ 
                          color: isMine ? '#E0E7FF' : '#6B7280',
                          fontSize: 12,
                          flexShrink: 1,
                          marginRight: 8,
                        }}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {firstAttachment.size ? `${(firstAttachment.size / 1024).toFixed(0)} KB` : 'Unknown'} • {(firstAttachment.name || 'file').split('.').pop()?.toUpperCase() || 'FILE'}
                      </Text>
                      <MaterialCommunityIcons 
                        name="download" 
                        size={18} 
                        color={isMine ? '#E0E7FF' : '#6B7280'} 
                        style={{ flexShrink: 0 }}
                      />
                    </View>
                  </TouchableOpacity>
                </View>
                
                {/* Timestamp inside bubble at bottom right */}
                <View style={{ width: '100%', flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
                  <Text style={{ 
                    fontSize: 10, 
                    color: isMine ? '#E0E7FF' : '#6B7280',
                    marginRight: 0,
                  }}>
                    {timestamp}
                  </Text>
                </View>
              </View>
            );
          })()}
          
          {/* Message content and timestamp in a flex container */}
          <View style={{ width: '100%' }}>
            {/* Display message text - NEVER show [IMAGE] or [FILE] markers as text */}
            {!isVoiceMessage && (
              messageText && messageText.trim() ? (
                <View>
                  <LinkText
                    text={messageText}
                    textStyle={{ 
                      color: isMine ? '#fff' : (isDark ? '#fff' : '#111827'),
                      fontSize: 16,
                      lineHeight: 20,
                      textAlign: 'left',
                    }}
                    linkStyle={{
                      fontSize: 16,
                      lineHeight: 20,
                    }}
                    isDark={isDark}
                    onVideoPress={(url) => setVideoUrl(url)}
                  />
                  {/* Timestamp below text message */}
                  {(!item.attachments || item.attachments.length === 0) && (
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
                      <Text style={{ 
                        fontSize: 10, 
                        color: isMine ? '#E0E7FF' : '#6B7280',
                        paddingRight: 2,
                      }}>{timestamp}</Text>
                    </View>
                  )}
                </View>
              ) : (!item.attachments || item.attachments.length === 0) && item.message ? (
                // If message exists but messageText is null, show original message
                // BUT filter out [IMAGE] and [FILE] markers
                (() => {
                  const rawMessage = item.message.trim();
                  // Don't show if message is ONLY a marker
                  if (rawMessage === '[IMAGE]' || rawMessage === '[FILE]') {
                    return null;
                  }
                  // Remove markers and show remaining text
                  const cleaned = rawMessage.replace(/\s*\[IMAGE\]$/g, '').replace(/\s*\[FILE\]$/g, '').trim();
                  if (cleaned) {
                    return (
                      <View>
                        <LinkText
                          text={cleaned}
                          textStyle={{ 
                            color: isMine ? '#fff' : (isDark ? '#fff' : '#111827'),
                            fontSize: 16,
                            lineHeight: 20,
                            textAlign: 'left',
                          }}
                          linkStyle={{
                            fontSize: 16,
                            lineHeight: 20,
                          }}
                          isDark={isDark}
                          onVideoPress={(url) => setVideoUrl(url)}
                        />
                        {/* Timestamp below text message */}
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
                          <Text style={{ 
                            fontSize: 10, 
                            color: isMine ? '#E0E7FF' : '#6B7280',
                            paddingRight: 2,
                          }}>{timestamp}</Text>
                        </View>
                      </View>
                    );
                  }
                  return null;
                })()
              ) : null
            )}
          </View>
        </View>
        </TouchableOpacity>
        
        {/* Message options modal */}
        {showMessageOptions === item.id && (
          <View style={{
            position: 'absolute',
            top: -20,
            right: isMine ? 0 : 'auto',
            left: isMine ? 'auto' : 0,
            backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
            borderRadius: 8,
            padding: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.25,
            shadowRadius: 4,
            elevation: 5,
            zIndex: 1000,
          }}>
            {/* Show Reply option for other users' messages */}
            {!isMine && (
              <TouchableOpacity
                onPress={() => handleReply(item)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                }}
              >
                <MaterialIcons name="reply" size={16} color={isDark ? '#fff' : '#000'} />
                <Text style={{ marginLeft: 8, color: isDark ? '#fff' : '#000', fontSize: 14 }}>Reply</Text>
              </TouchableOpacity>
            )}
            
            {/* Show Delete option for your own messages */}
            {isMine && (
              <TouchableOpacity
                onPress={() => handleDeleteMessage(item.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                }}
              >
                <MaterialIcons name="delete" size={16} color="#EF4444" />
                <Text style={{ marginLeft: 8, color: '#EF4444', fontSize: 14 }}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        </View>
      </View>
    );
  };

  // Handle emoji select
  const handleEmojiSelect = (emoji: any) => {
    setInput(input + emoji.native);
    setShowEmoji(false);
  };

  useEffect(() => {
    fetchMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]); // fetchMessages is stable, no need to include in deps

  // Format message date for separators
  const formatMessageDate = (dateString: string | null | undefined) => {
    // Validate date string
    if (!dateString) return 'Today';
    
    const messageDate = new Date(dateString);
    
    // Check if date is invalid
    if (isNaN(messageDate.getTime())) {
      // Invalid date string
      return 'Today'; // Default to "Today" for invalid dates
    }
    
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Reset time to compare only dates
    const messageDateOnly = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate());
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const yesterdayOnly = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
    
    if (messageDateOnly.getTime() === todayOnly.getTime()) {
      return 'Today';
    } else if (messageDateOnly.getTime() === yesterdayOnly.getTime()) {
      return 'Yesterday';
    } else {
      // Ensure date is valid before formatting
      try {
        return messageDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      } catch {
        // Error formatting date
        return 'Today'; // Default fallback
      }
    }
  };

  const formatMessageTime = (dateString: string) => {
    try {
      // Handle invalid or empty date strings
      if (!dateString || dateString === 'Invalid Date' || dateString === 'null' || dateString === 'undefined') {
        return new Date().toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        });
      }
      
      const date = new Date(dateString);
      
      // Check if the date is valid
      if (isNaN(date.getTime())) {
        // Invalid time string
        return new Date().toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        });
      }
      
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      });
    } catch (error) {
      console.error('Error formatting message time:', error, 'Date string:', dateString);
      return new Date().toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      });
    }
  };

  const shouldShowDateSeparator = (currentMessage: any, previousMessage: any) => {
    if (!previousMessage) return true;
    
    // Validate dates before parsing
    if (!currentMessage?.created_at || !previousMessage?.created_at) {
      return false; // Don't show separator if dates are invalid
    }
    
    const currentDate = new Date(currentMessage.created_at);
    const previousDate = new Date(previousMessage.created_at);
    
    // Check if dates are valid
    if (isNaN(currentDate.getTime()) || isNaN(previousDate.getTime())) {
      // Invalid date in shouldShowDateSeparator
      return false; // Don't show separator for invalid dates
    }
    
    // Compare only dates (not time)
    const currentDateOnly = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    const previousDateOnly = new Date(previousDate.getFullYear(), previousDate.getMonth(), previousDate.getDate());
    
    return currentDateOnly.getTime() !== previousDateOnly.getTime();
  };

  return (
    <View
      className={isDark ? 'bg-gray-900' : 'bg-white'}
      style={{ flex: 1 }}
    >
        <StatusBar 
        barStyle={isDark ? 'light-content' : 'dark-content'} 
        backgroundColor={isDark ? '#111827' : '#FFFFFF'} 
      />
      {/* Header */}
      <View style={{ zIndex: 10 }} className={`border-b ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        {/* Main Header */}
        <View className="flex-row items-center p-4 pt-12">
          <TouchableOpacity onPress={() => {
            // Navigate directly to groups tab
            router.replace('/groups');
          }} className="mr-3">
            <MaterialCommunityIcons name="arrow-left" size={24} color={isDark ? '#fff' : '#000'} />
          </TouchableOpacity>
          
          {/* Group Avatar and Info */}
          <TouchableOpacity 
            onPress={handleGroupHeaderPress} 
            className="flex-1 flex-row items-center"
          >
            {/* Group Avatar */}
            <GroupAvatar
              avatarUrl={groupInfo?.avatar_url}
              name={groupInfo?.name || `Group ${id}`}
              size={48}
            />
            
            {/* Group Info */}
            <View className="flex-1">
              <Text className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {groupInfo?.name || `Group ${id}`}
              </Text>
              <Text className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                {groupInfo?.users?.length || 0} members • {messages.length} messages
              </Text>
            </View>
          </TouchableOpacity>
          
          {/* Group Info Button */}
          <TouchableOpacity onPress={() => {
            if (groupInfo) {
              const groupData = encodeURIComponent(JSON.stringify(groupInfo));
              router.push(`/group-info?id=${id}&groupData=${groupData}`);
            } else {
              router.push(`/group-info?id=${id}`);
            }
          }}>
            <MaterialCommunityIcons name="information-outline" size={24} color={isDark ? '#fff' : '#000'} />
          </TouchableOpacity>
        </View>

        {/* Group Members Section */}
        {showGroupMembers && groupInfo?.users && (
          <View className={`px-4 pb-4 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <Text className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              Group Members ({groupInfo.users.length})
            </Text>
            <View className="flex-row flex-wrap">
              {groupInfo.users.map((member: any, index: number) => (
                <View 
                  key={member.id} 
                  className={`flex-row items-center mr-4 mb-2 ${
                    index < 3 ? '' : 'opacity-60'
                  }`}
                >
                  {/* Member Avatar */}
                  <UserAvatar
                    avatarUrl={member.avatar_url}
                    name={member.name}
                    size={32}
                    style={{ marginRight: 8 }}
                  />
                  
                  {/* Member Name */}
                  <Text className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    {member.name}
                  </Text>
                  
                  {/* Owner Badge */}
                  {member.id === groupInfo.owner_id && (
                    <View className="ml-1">
                      <MaterialCommunityIcons name="star" size={12} color="#F59E0B" />
                    </View>
                  )}
                </View>
              ))}
              
              {/* Show more indicator if there are many members */}
              {groupInfo.users.length > 6 && (
                <View className="flex-row items-center mr-4 mb-2">
                  <View className="w-8 h-8 rounded-full bg-gray-400 items-center justify-center mr-2">
                    <Text className="text-white font-medium text-xs">
                      +{groupInfo.users.length - 6}
                    </Text>
                  </View>
                  <Text className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    more
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={{ 
          flex: 1,
          justifyContent: 'flex-end' // Always keep input at bottom
        }}>
          {loading ? (
            <View className="flex-1 justify-center items-center">
              <ActivityIndicator size="large" color="#283891" />
            </View>
          ) : (
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => {
                setShowMessageOptions(null);
                Keyboard.dismiss();
              }}
              style={{ flex: 1 }}
            >
              <FlatList
                ref={flatListRef}
                data={messages}
                renderItem={renderItem}
                keyExtractor={(item, index) => {
                  if (item && item.id !== undefined && item.id !== null) {
                    return `message-${item.id}-${index}`;
                  }
                  return `message-fallback-${index}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                }}
                contentContainerStyle={{ 
                  padding: 16, 
                  paddingBottom: 0, // Let KeyboardAvoidingView handle spacing
                }}
                inverted={false} // Make sure it's not inverted
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              onScroll={({ nativeEvent }) => {
                const { contentOffset } = nativeEvent;
                
                const isAtTop = contentOffset.y <= 50;
                
                // Debounce: only trigger once every 2 seconds
                const now = Date.now();
                if (isAtTop && hasMoreMessages && !loadingMore && (now - lastScrollTrigger > 2000)) {
                  setLastScrollTrigger(now);
                  loadMoreMessages();
                }
              }}
              onScrollEndDrag={({ nativeEvent }) => {
                const { contentOffset } = nativeEvent;
                const isAtTop = contentOffset.y <= 50;
                
                // Debounce: only trigger once every 2 seconds
                const now = Date.now();
                if (isAtTop && hasMoreMessages && !loadingMore && (now - lastScrollTrigger > 2000)) {
                  setLastScrollTrigger(now);
                  loadMoreMessages();
                }
              }}
              scrollEventThrottle={100}
              ListHeaderComponent={() => 
                loadingMore ? (
                  <View style={{ padding: 20, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color="#283891" />
                    <Text style={{ color: isDark ? '#9CA3AF' : '#6B7280', marginTop: 8 }}>
                      Loading more messages...
                    </Text>
                  </View>
                ) : null
              }
              onContentSizeChange={() => {
                // No auto-scroll here - useEffect handles initial scroll once
              }}
              onLayout={() => {
                // No auto-scroll here - useEffect handles initial scroll once
              }}
            />
          </TouchableOpacity>
        )}
        
            {/* Reply Preview */}
            {replyingTo && (
              <ReplyPreview
                replyTo={replyingTo}
                onCancel={handleCancelReply}
              />
            )}
            
            {/* Emoji Picker */}
            {showEmoji && (
              <View style={{ height: 320 }}>
                <Picker theme={isDark ? 'dark' : 'light'} onSelect={handleEmojiSelect} />
              </View>
            )}
            
            {/* Attachment Preview */}
            {attachment && (
              <View className="flex-row items-center px-2 pb-1">
                {attachment.isImage ? (
                  <Image source={{ uri: attachment.uri }} style={{ width: 60, height: 60, borderRadius: 8, marginRight: 8 }} />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
                    <MaterialCommunityIcons name="file" size={28} color="#283891" />
                    <Text style={{ marginLeft: 6, color: isDark ? '#fff' : '#111827' }}>{attachment.name}</Text>
                  </View>
                )}
                <TouchableOpacity onPress={() => setAttachment(null)}>
                  <MaterialCommunityIcons name="close-circle" size={28} color="#EF4444" />
                </TouchableOpacity>
              </View>
            )}
            
            {/* Voice Recording Preview - Above Input */}
            {voiceRecording && (
              <View 
                style={{
                  backgroundColor: isDark ? '#374151' : '#F3F4F6',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderTopWidth: 1,
                  borderTopColor: isDark ? '#4B5563' : '#D1D5DB',
                }}
              >
                <View className="flex-row items-center">
                  <MaterialCommunityIcons name="microphone" size={20} color="#39B54A" />
                  <View className="flex-1 ml-3">
                    <VoicePlayer 
                      uri={voiceRecording.uri} 
                      duration={voiceRecording.duration}
                      size="small"
                    />
                  </View>
                  <TouchableOpacity onPress={() => setVoiceRecording(null)}>
                    <MaterialCommunityIcons name="close-circle" size={24} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            )}
            
            {/* Input Bar - WhatsApp Style */}
            <View
              style={{
                backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
                paddingHorizontal: 16,
                paddingVertical: 8,
                paddingBottom: Platform.OS === 'android' 
                  ? (keyboardHeight > 0 ? 0 : insets.bottom) // ✅ No padding when keyboard open, safe area padding when dismissed
                  : Math.max(insets.bottom + 8, keyboardHeight > 0 ? 8 : 16),
                borderTopWidth: 1,
                borderTopColor: isDark ? '#374151' : '#E5E7EB',
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  backgroundColor: isDark ? '#374151' : '#F3F4F6',
                  borderRadius: 25,
                  paddingHorizontal: 4,
                  paddingVertical: 4,
                  minHeight: 50,
                }}
              >
                {/* Emoji Button */}
                <TouchableOpacity 
                  onPress={() => setShowEmoji(v => !v)} 
                  style={{ 
                    width: 42, 
                    height: 42, 
                    borderRadius: 21, 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    marginRight: 4,
                  }}
                >
                  <MaterialCommunityIcons name="emoticon-outline" size={24} color="#6B7280" />
                </TouchableOpacity>

                {/* Text Input */}
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder="Message"
                  placeholderTextColor={isDark ? '#9CA3AF' : '#6B7280'}
                  style={{
                    flex: 1,
                    minHeight: 42,
                    maxHeight: 100,
                    backgroundColor: 'transparent',
                    color: isDark ? '#fff' : '#111827',
                    fontSize: 16,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    textAlignVertical: 'center',
                  }}
                  editable={!sending}
                  multiline
                  onSubmitEditing={handleSend}
                  returnKeyType="send"
                  blurOnSubmit={false}
                />

                {/* Gallery Button */}
                <TouchableOpacity 
                  onPress={pickImage} 
                  style={{ 
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 4,
                  }}
                >
                  <MaterialCommunityIcons name="image" size={24} color="#6B7280" />
                </TouchableOpacity>

                {/* Attachment Button */}
                <TouchableOpacity 
                  onPress={pickFile} 
                  style={{ 
                    width: 42, 
                    height: 42, 
                    borderRadius: 21, 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    marginRight: 4,
                  }}
                >
                  <MaterialCommunityIcons name="paperclip" size={24} color="#6B7280" />
                </TouchableOpacity>

                {/* Send/Mic Button */}
                {(!input.trim() && !attachment && !voiceRecording) ? (
                  <TouchableOpacity 
                    onPress={handleVoiceRecording} 
                    style={{ 
                      width: 42, 
                      height: 42, 
                      borderRadius: 21, 
                      backgroundColor: '#39B54A',
                      alignItems: 'center', 
                      justifyContent: 'center',
                    }}
                  >
                    <MaterialCommunityIcons name="microphone" size={24} color="#fff" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity 
                    onPress={handleSend} 
                    disabled={sending} 
                    style={{ 
                      width: 42, 
                      height: 42, 
                      borderRadius: 21, 
                      backgroundColor: sending ? '#A5B4FC' : '#39B54A',
                      alignItems: 'center', 
                      justifyContent: 'center',
                    }}
                  >
                    <MaterialCommunityIcons name="send" size={24} color="#fff" />
                  </TouchableOpacity>
                )}
          </View>
        </View>
        </View>
      </KeyboardAvoidingView>

      {/* Voice Recorder Modal */}
      <Modal
        visible={showVoiceRecorder}
        transparent
        animationType="slide"
        onRequestClose={handleVoiceRecordingCancel}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
        }}>
          <View style={{
            backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
            borderRadius: 16,
            padding: 20,
            width: '100%',
            maxWidth: 400,
          }}>
            <VoiceRecorder
              onRecordingComplete={handleVoiceRecordingComplete}
              onCancel={handleVoiceRecordingCancel}
              maxDuration={60}
            />
          </View>
        </View>
      </Modal>

      {/* Image Preview Modal */}
      <Modal
        visible={!!showImagePreview}
        transparent
        animationType="fade"
        onRequestClose={() => setShowImagePreview(null)}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          <TouchableOpacity 
            style={{
              position: 'absolute',
              top: 50,
              right: 20,
              zIndex: 1,
            }}
            onPress={() => setShowImagePreview(null)}
          >
            <MaterialCommunityIcons name="close" size={30} color="#fff" />
          </TouchableOpacity>
          
          <Image 
            source={{ uri: showImagePreview || '' }}
            style={{
              width: '90%',
              height: '80%',
              resizeMode: 'contain',
            }}
            onError={(error) => {
              // Silent fail for image preview loading
            }}
          />
        </View>
      </Modal>

      {/* Video Player Modal */}
      {videoUrl && (
        <Modal
          visible={!!videoUrl}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setVideoUrl(null)}
        >
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            <TouchableOpacity
              style={{
                position: 'absolute',
                top: 50,
                right: 20,
                zIndex: 1000,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                borderRadius: 20,
                padding: 8,
              }}
              onPress={() => setVideoUrl(null)}
            >
              <MaterialCommunityIcons name="close" size={32} color="#fff" />
            </TouchableOpacity>
            <VideoPlayer
              url={videoUrl}
              isMine={false}
              isDark={true}
              style={{ flex: 1 }}
            />
          </View>
        </Modal>
      )}
    </View>
  );
}