import MessageStatus from '@/components/MessageStatus';
import ReplyBubble from '@/components/ReplyBubble';
import ReplyPreview from '@/components/ReplyPreview';
import UserAvatar from '@/components/UserAvatar';
import VoiceMessageBubble from '@/components/VoiceMessageBubble';
import VoicePlayer from '@/components/VoicePlayer';
import VoiceRecorder from '@/components/VoiceRecorder';
import { AppConfig } from '@/config/app.config';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useTheme } from '@/context/ThemeContext';
import { messagesAPI, usersAPI } from '@/services/api';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Picker } from 'emoji-mart-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, FlatList, Image, InteractionManager, Keyboard, Modal, Platform, StatusBar, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const options = ({ params }) => ({
  headerShown: false, // Hide the default header, use custom header instead
});

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

export default function UserChatScreen() {
  const { id } = useLocalSearchParams();
  const { currentTheme } = useTheme();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { updateUnreadCount } = useNotifications();
  const insets = useSafeAreaInsets();
  const ENABLE_MARK_AS_READ = true; // Enable mark as read functionality
  const ENABLE_DELETE_MESSAGE = true; // Enable delete - route exists
  
  // Remove the navigation effect - let the AppLayout handle authentication state changes
  const isDark = currentTheme === 'dark';
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [attachment, setAttachment] = useState(null); // { uri, name, type, isImage }
  const [userInfo, setUserInfo] = useState<any>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState<{ uri: string; duration: number } | null>(null);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [showImagePreview, setShowImagePreview] = useState<string | null>(null);
  const [showMessageOptions, setShowMessageOptions] = useState<number | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const flatListRef = useRef(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastScrollTrigger, setLastScrollTrigger] = useState(0);

  // Debug: Log when userInfo changes
  useEffect(() => {
    // UserInfo state changed
  }, [userInfo]);

  // Fetch messages and user info
  useEffect(() => {
    let isMounted = true;
    const fetchMessages = async () => {
      setLoading(true);
      setHasScrolledToBottom(false); // Reset scroll flag when fetching new messages
      setInitialScrollIndex(undefined); // Reset initial scroll index when fetching new messages
      try {
        const res = await messagesAPI.getByUser(id, 1, 10);
        
        // Handle Laravel pagination format
        const messagesData = res.data.messages?.data || res.data.messages || [];
        const pagination = res.data.messages || {};
        
        // Debug each message's attachments
        messagesData.forEach((message, index) => {
          if (message.attachments && message.attachments.length > 0) {
            // Message has attachments
          }
        });
        
        // Check if there are more messages using Laravel pagination
        // Try multiple possible pagination formats
        const hasMore = pagination.current_page < pagination.last_page || 
                       pagination.current_page < pagination.lastPage ||
                       (pagination.current_page && pagination.last_page && pagination.current_page < pagination.last_page) ||
                       (messagesData.length >= 10); // Fallback: if we got 10 messages, assume there might be more
        
        setHasMoreMessages(hasMore);
        
        // Debug: Log messages with reply_to_id to check backend response
        const messagesWithReply = messagesData.filter((msg: any) => msg.reply_to_id);
        if (messagesWithReply.length > 0) {
          console.log('Messages with reply_to_id:', messagesWithReply.map((msg: any) => ({
            id: msg.id,
            message: msg.message,
            reply_to_id: msg.reply_to_id,
            has_reply_to_object: !!msg.reply_to,
            reply_to: msg.reply_to
          })));
        }
        
        // Process messages to ensure reply_to data is properly structured
        // If a message has reply_to_id but no reply_to object, we need to find the original message
        const processedMessages = messagesData.map((msg: any) => {
          // If message already has reply_to object, use it (backend loaded it correctly)
          if (msg.reply_to) {
            console.log('Message has reply_to from backend:', msg.id, msg.reply_to);
            return msg;
          }
          
          // If message has reply_to_id but no reply_to object, try to find it in the messages list
          if (msg.reply_to_id) {
            console.log('Message has reply_to_id but no reply_to object, searching in messages list:', msg.id, msg.reply_to_id);
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
              console.log('Constructed reply_to from local messages:', msg.id, msg.reply_to);
            } else {
              console.warn('Could not find replied message in current batch:', msg.id, 'replying to:', msg.reply_to_id);
            }
          }
          
          return msg;
        });
        
        // Sort messages by created_at in ascending order (oldest first)
        const sortedMessages = processedMessages.sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        
        // Find the newest message index for initial scroll
        const newestMessageId = pagination.newest_message_id;
        let lastIndex = sortedMessages.length - 1;
        
        // If we have newest_message_id, find its index after sorting
        if (newestMessageId) {
          const newestIndex = sortedMessages.findIndex(msg => msg.id === newestMessageId);
          if (newestIndex >= 0) {
            lastIndex = newestIndex;
            console.log('Found newest message at index:', newestIndex, 'ID:', newestMessageId);
          } else {
            console.log('Newest message ID not found in sorted messages, using last index');
          }
        }
        
        setMessages(sortedMessages);
        
        // Set initial scroll index AFTER setting messages
        // This ensures FlatList has the data before trying to scroll
        if (lastIndex >= 0 && sortedMessages.length > 0) {
          // Use setTimeout to ensure state update happens after messages are set
          setTimeout(() => {
            setInitialScrollIndex(lastIndex);
            console.log('Setting initialScrollIndex to:', lastIndex);
          }, 0);
        }
        setUserInfo(res.data.selectedConversation);
        
        // Set loading to false BEFORE scroll attempts so scroll handlers can work
        setLoading(false);
        
        // Reset scroll flag to allow initial scroll
        setHasScrolledToBottom(false);
        
        // Immediately try to scroll to bottom after messages are set
        // Use multiple attempts with increasing delays to ensure it works
        if (sortedMessages.length > 0) {
          // Multiple scroll attempts with increasing delays
          const scrollAttempts = [100, 300, 500, 800, 1200];
          scrollAttempts.forEach((delay, index) => {
            setTimeout(() => {
              if (flatListRef.current && sortedMessages.length > 0) {
                try {
                  // Try scrollToEnd first (most reliable)
                  flatListRef.current.scrollToEnd({ animated: false });
                  console.log(`Scroll attempt ${index + 1} (scrollToEnd) at ${delay}ms`);
                  
                  // scrollToEnd should be sufficient, but we'll keep trying
                } catch (error) {
                  console.log(`Scroll attempt ${index + 1} failed:`, error);
                }
              }
            }, delay);
          });
        }
        
        // Mark messages as read when user opens conversation
        // Use the new route: PUT /api/messages/mark-read/{userId}
        if (ENABLE_MARK_AS_READ) {
          try {
            await messagesAPI.markMessagesAsRead(Number(id));
            // Update unread count to 0 for this conversation - this will update badge
            updateUnreadCount(Number(id), 0);
          } catch (error: any) {
            // Ignore validation (422) or missing route errors
            console.log('markMessagesAsRead failed:', error?.response?.status || error?.message || error);
          }
        }
        
        // Calculate online status from last_seen_at from user data
        // last_seen_at is on the User model, so check in user data within selectedConversation
        if (res.data.selectedConversation) {
          const conversation = res.data.selectedConversation;
          // Debug: Log what data we're receiving
          console.log('Conversation data:', {
            id: conversation.id,
            name: conversation.name,
            user: conversation.user,
            last_seen_at: conversation.user?.last_seen_at || conversation.last_seen_at,
          });
          
          // Get last_seen_at from user data (user.last_seen_at) or fallback to conversation level
          const lastSeenTimestamp = conversation.user?.last_seen_at || 
                                    conversation.last_seen_at || 
                                    conversation.last_seen || 
                                    conversation.lastSeen;
          
          if (lastSeenTimestamp) {
            try {
              const lastSeenDate = new Date(lastSeenTimestamp);
              const now = new Date();
              const diffInMs = now.getTime() - lastSeenDate.getTime();
              const diffInMinutes = diffInMs / (1000 * 60);
              
              // Consider user online if active within last 5 minutes
              const isUserOnline = !isNaN(lastSeenDate.getTime()) && diffInMinutes >= 0 && diffInMinutes <= 5;
              setIsOnline(isUserOnline);
              
              console.log('Calculated online status:', isUserOnline, 'Last seen:', diffInMinutes.toFixed(2), 'minutes ago');
            } catch (error) {
              console.error('Error calculating online status:', error);
              setIsOnline(false);
            }
          } else {
            // No last_seen_at data available
            console.warn('No last_seen_at data found in conversation response');
            setIsOnline(false);
          }
        }
        
        // Scroll will be handled by useEffect and onContentSizeChange after images render
      } catch (e) {
        setMessages([]);
        setLoading(false);
      }
    };
    fetchMessages();
    return () => { isMounted = false; };
  }, [id]);

  // Debug: Log all keys and check for duplicates before rendering FlatList
  useEffect(() => {
    const keys = messages.map((item, index) => {
      if (item && item.id !== undefined && item.id !== null) {
        return `message-${item.id}`;
      }
      return `message-fallback-${index}`;
    });
    // Check for duplicate keys
    const keySet = new Set();
    const duplicateKeys = keys.filter(key => {
      if (keySet.has(key)) return true;
      keySet.add(key);
      return false;
    });
    if (duplicateKeys.length > 0) {
      console.warn('Duplicate message keys found:', duplicateKeys);
    }
    // Check for duplicate IDs
    const ids = messages.map(m => m.id);
    const duplicateIds = ids.filter((id, idx) => id !== undefined && id !== null && ids.indexOf(id) !== idx);
    if (duplicateIds.length > 0) {
      console.warn('Duplicate message IDs found:', duplicateIds);
    }
  }, [messages]);

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

  // Track if we've done initial scroll
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  
  // Track initial scroll index for FlatList
  const [initialScrollIndex, setInitialScrollIndex] = useState<number | undefined>(undefined);

  // Force scroll to bottom when component first loads (after images render)
  useEffect(() => {
    if (flatListRef.current && messages.length > 0 && !loading) {
      // Check if last message has images - if so, wait longer
      const lastMessage = messages[messages.length - 1];
      const hasImages = lastMessage?.attachments?.some((att: any) => 
        att.mime?.startsWith('image/') || att.type?.startsWith('image/')
      );
      
      // Use InteractionManager to wait for all interactions to complete
      const interactionHandle = InteractionManager.runAfterInteractions(() => {
        // Multiple scroll attempts with increasing delays to ensure it works
        const delays = hasImages ? [200, 500, 1000, 1500] : [100, 300, 600, 1000];
        
        delays.forEach((delay, index) => {
          setTimeout(() => {
            if (flatListRef.current && messages.length > 0) {
              try {
                // Use scrollToEnd as primary method - it's more reliable for scrolling to bottom
                flatListRef.current.scrollToEnd({ animated: false });
                console.log(`useEffect scroll attempt ${index + 1} (scrollToEnd) at ${delay}ms`);
                
                // Also try scrollToIndex as backup
                const lastIndex = messages.length - 1;
                if (lastIndex >= 0) {
                  setTimeout(() => {
                    if (flatListRef.current) {
                      try {
                        flatListRef.current.scrollToIndex({ 
                          index: lastIndex, 
                          animated: false,
                          viewPosition: 1
                        });
                        console.log(`useEffect scroll attempt ${index + 1} (scrollToIndex) to index ${lastIndex}`);
                      } catch (e) {
                        // Ignore - scrollToEnd might have worked
                      }
                    }
                  }, 50);
                }
                
                if (index === delays.length - 1) {
                  // Only set flag on last attempt to avoid premature flag setting
                  setHasScrolledToBottom(true);
                  console.log(`Initial scroll to bottom completed via useEffect (attempt ${index + 1})`);
                }
              } catch (error) {
                console.warn(`useEffect scroll attempt ${index + 1} failed:`, error);
                // Last resort: try scrollToIndex
                if (index === delays.length - 1) {
                  try {
                    const lastIndex = messages.length - 1;
                    if (lastIndex >= 0 && flatListRef.current) {
                      flatListRef.current.scrollToIndex({ 
                        index: lastIndex, 
                        animated: false,
                        viewPosition: 1
                      });
                      setHasScrolledToBottom(true);
                      console.log('Initial scroll to bottom completed via scrollToIndex (fallback)');
                    }
                  } catch (scrollError) {
                    console.warn('All scroll attempts failed:', scrollError);
                  }
                }
              }
            }
          }, delay);
        });
      });
      
      return () => {
        interactionHandle.cancel();
      };
    }
  }, [loading, messages.length]);

  // Mark messages as read when conversation is opened
  useFocusEffect(
    useCallback(() => {
      const markMessagesAsRead = async () => {
        if (!ENABLE_MARK_AS_READ || !id || !user) return;
        
        try {
          // Mark all unread messages from this user as read
          // Use the new route: PUT /api/messages/mark-read/{userId}
          await messagesAPI.markMessagesAsRead(Number(id));
          
          // Update local messages state to reflect read status
          // Mark messages as read where sender_id === other user's id and receiver_id === current user's id
          setMessages(prevMessages => {
            const now = new Date().toISOString();
            return prevMessages.map(msg => {
              // If this message was sent by the other user to the current user and hasn't been read yet
              if (msg.sender_id === Number(id) && msg.receiver_id === user.id && !msg.read_at) {
                return { ...msg, read_at: now };
              }
              return msg;
            });
          });
          
          // Update unread count to 0 for this conversation (instead of removing it)
          // This ensures the UI updates immediately
          updateUnreadCount(Number(id), 0);
          
          console.log('Messages marked as read for conversation:', id);
        } catch (error) {
          console.error('Error marking messages as read:', error);
          // Don't show error to user - this is a background operation
        }
      };

      // Small delay to ensure screen is fully loaded
      const timer = setTimeout(() => {
        markMessagesAsRead();
      }, 300);

      return () => clearTimeout(timer);
    }, [id, user, ENABLE_MARK_AS_READ, updateUnreadCount])
  );

  // Handle mobile hardware back button
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        // Navigate directly to messages tab (root)
        router.replace('/');
        return true; // Prevent default back behavior
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [])
  );

  // Load more messages function
  const loadMoreMessages = async () => {
    if (loadingMore || !hasMoreMessages) return;
    
    setLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const res = await messagesAPI.getByUser(id, nextPage, 10);
      
      // Handle Laravel pagination format
      const newMessages = res.data.messages?.data || res.data.messages || [];
      const pagination = res.data.messages || {};
      
      if (newMessages.length === 0) {
        setHasMoreMessages(false);
        return;
      }
      
      // Process messages to ensure reply_to data is properly structured
      // If a message has reply_to_id but no reply_to object, we need to find the original message
      const processedNewMessages = newMessages.map((msg: any) => {
        // If message already has reply_to object, use it
        if (msg.reply_to) {
          return msg;
        }
        
        // If message has reply_to_id but no reply_to object, we'll resolve it after combining with existing messages
        return msg;
      });
      
      // Sort new messages by created_at in ascending order (oldest first)
      const sortedNewMessages = processedNewMessages.sort((a, b) => 
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
      
      // Maintain scroll position after loading more messages
      setTimeout(() => {
        if (flatListRef.current) {
          // Calculate the new scroll position to maintain the user's view
          const newScrollPosition = sortedNewMessages.length * 100; // Approximate height per message
          flatListRef.current.scrollToOffset({ 
            offset: newScrollPosition, 
            animated: false 
          });
        }
      }, 100);
      
      // Check if there are more messages using Laravel pagination
      const hasMore = pagination.current_page < pagination.last_page || 
                     pagination.current_page < pagination.lastPage ||
                     (pagination.current_page && pagination.last_page && pagination.current_page < pagination.last_page) ||
                     (newMessages.length >= 10); // Fallback: if we got 10 messages, assume there might be more
      
      setHasMoreMessages(hasMore);
      
    } catch (error) {
      console.error('Error loading more messages:', error);
    } finally {
      setLoadingMore(false);
    }
  };

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
      
      formData.append('receiver_id', id);
      
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
        // Use a stable filename and correct MIME
        formData.append('attachments[]', {
          uri: voiceRecording.uri,
          name: 'voice_message.m4a',
          type: 'audio/m4a',
        } as any);

        // Optional metadata (controller will ignore unknown fields)
        formData.append('voice_duration', voiceRecording.duration.toString());
        formData.append('is_voice_message', 'true');
      }
      
      const res = await messagesAPI.sendMessage(formData);
      
      // Update last_seen_at when user sends a message (activity indicator)
      try {
        await usersAPI.updateLastSeen();
      } catch (error) {
        // Silently fail - don't block message sending if last_seen update fails
        console.warn('Failed to update last_seen_at:', error);
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
        sender_id: res.data.sender_id || Number(user?.id), // Ensure sender_id is set as number
        receiver_id: res.data.receiver_id || Number(id), // Ensure receiver_id is set
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
      
      console.log('New message sent (individual):', {
        id: newMessage.id,
        message: newMessage.message,
        originalInput: input.trim(),
        messageTextToPreserve: messageTextToPreserve,
        resDataMessage: res.data?.message,
        sender_id: newMessage.sender_id,
        user_id: user?.id,
        isMine: newMessage.sender_id === user?.id,
        sender: newMessage.sender,
        fullResData: res.data
      });
      
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
              } catch (error) {
                // If scrollToEnd fails, try scrolling to the last item by index
                console.warn('scrollToEnd failed, trying scrollToIndex:', error);
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
                } catch (scrollError) {
                  console.warn('scrollToIndex also failed:', scrollError);
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
              } catch (error) {
                console.warn('Second scrollToEnd failed:', error);
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
    } catch (e) {
      console.error('Error sending message:', e);
      console.error('Error details:', {
        message: e.message,
        status: e.response?.status,
        statusText: e.response?.statusText,
        data: e.response?.data,
        requestData: {
          input: input,
          hasAttachment: !!attachment,
          hasVoiceRecording: !!voiceRecording,
          voiceDuration: voiceRecording?.duration,
          replyingTo: replyingTo?.id
        }
      });
      
      // Handle specific database constraint errors
      if (e.response?.data?.exception === 'Illuminate\\Database\\QueryException') {
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
      // Normalize filename and mime type for upload compatibility
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
      
      // Support both legacy { type: 'success' } and newer { canceled, assets } shapes
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
      console.error('pickFile error:', e);
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
              console.log('Deleting message ID:', messageId);
              const response = await messagesAPI.deleteMessage(messageId);
              console.log('Delete response:', response.data);
              
              // Remove message from local state
              setMessages(prev => prev.filter(msg => msg.id !== messageId));
              setShowMessageOptions(null);
              
              // Optionally refresh messages to get updated last_message
              // You can add this if needed
            } catch (error: any) {
              console.error('Error deleting message:', error);
              console.error('Error response:', error?.response?.data);
              console.error('Error status:', error?.response?.status);
              
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

  // Render message bubble
  const renderItem = ({ item, index }) => {
    // Ensure sender_id and user.id are compared as numbers
    const senderId = Number(item.sender_id);
    const currentUserId = Number(user?.id);
    const isMine = senderId === currentUserId && senderId !== 0;
    const previousMessage = index > 0 ? messages[index - 1] : null;
    const showDateSeparator = shouldShowDateSeparator(item, previousMessage);
    
    // Safe date parsing to avoid invalid date errors
    let timestamp = 'Now';
    try {
      const date = new Date(item.created_at);
      if (!isNaN(date.getTime())) {
        timestamp = formatMessageTime(item.created_at);
      }
    } catch (error) {
      console.warn('Invalid date for message:', item.created_at, error);
      timestamp = 'Now';
    }

    // Check if this is a voice message (look for voice message format in text)
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
    
    // Check for voice message format: [VOICE_MESSAGE:duration] (at end of message)
    const voiceMatch = item.message?.match(/\[VOICE_MESSAGE:(\d+)\]$/);
    
    if (voiceMatch) {
      // This is a voice message - ALWAYS render as voice bubble regardless of attachments
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
      // Check for audio attachment in regular messages (only if NOT a voice message)
      const audioAttachment = item.attachments.find(att => att.mime?.startsWith('audio/'));
      if (audioAttachment) {
        // For audio attachments, clean the message text
        messageText = cleanMessageText(item.message);
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
            textPart={voiceMessageData.textPart}
            readAt={item.read_at}
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
          
          {item.attachments && item.attachments.length > 0 && (
            item.attachments[0].mime?.startsWith('image/') ? (
              <View style={{ width: '100%' }}>
                <TouchableOpacity 
                  onPress={() => {
                    // Try multiple possible URL fields and construct full URL
                    let imageUrl = item.attachments[0].url || 
                                  item.attachments[0].path || 
                                  item.attachments[0].uri;
                    
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
                        let url = item.attachments[0].url || item.attachments[0].path || item.attachments[0].uri;
                        
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
                
                {/* Timestamp and read receipt below image */}
                <View style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  alignSelf: 'flex-end',
                  marginTop: 4,
                  marginRight: 2,
                  gap: 4,
                }}>
                  <Text style={{ 
                    fontSize: 10, 
                    color: isMine ? '#E0E7FF' : '#6B7280',
                  }}>{timestamp}</Text>
                  {/* Show read receipt only for messages we sent */}
                  {isMine && (
                    <MessageStatus 
                      readAt={item.read_at} 
                      isDark={isDark}
                      size={12}
                    />
                  )}
                </View>
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
                      const fileUrl = item.attachments[0].url || item.attachments[0].path || item.attachments[0].uri;
                      let downloadUrl = fileUrl;
                      if (fileUrl && !fileUrl.startsWith('http')) {
                        const cleanUrl = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
                        downloadUrl = `${getBaseUrl()}/${cleanUrl}`;
                      }
                      
                      const fileName = item.attachments[0].name || 'download';
                      
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
                      {item.attachments[0].name}
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
                        {item.attachments[0].size ? `${(item.attachments[0].size / 1024).toFixed(0)} KB` : 'Unknown'} • {(item.attachments[0].name || 'file').split('.').pop()?.toUpperCase() || 'FILE'}
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
                
                {/* Timestamp and read receipt inside bubble at bottom right */}
                <View style={{ width: '100%', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 4 }}>
                  <Text style={{ 
                    fontSize: 10, 
                    color: isMine ? '#E0E7FF' : '#6B7280',
                    marginRight: 4,
                  }}>
                    {timestamp}
                  </Text>
                  {/* Show read receipt only for messages we sent */}
                  {isMine && (
                    <MessageStatus 
                      readAt={item.read_at} 
                      isDark={isDark}
                      size={12}
                    />
                  )}
                </View>
              </View>
            )
          )}
          
          {/* Message content and timestamp in a flex container */}
          <View style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
            {/* Display message text - NEVER show [IMAGE] or [FILE] markers as text */}
            {!isVoiceMessage && (
              messageText && messageText.trim() ? (
                <Text 
                  style={{ 
                    color: isMine ? '#fff' : (isDark ? '#fff' : '#111827'),
                    fontSize: 16,
                    lineHeight: 20,
                    textAlign: 'left',
                    flexWrap: 'wrap', // Ensure text wraps properly
                    wordBreak: 'break-word', // Prevent words from breaking unnecessarily
                  }}
                >
                  {messageText}
                </Text>
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
                      <Text 
                        style={{ 
                          color: isMine ? '#fff' : (isDark ? '#fff' : '#111827'),
                          fontSize: 16,
                          lineHeight: 20,
                          textAlign: 'left',
                        }}
                      >
                        {cleaned}
                      </Text>
                    );
                  }
                  return null;
                })()
              ) : null
            )}
            
            {/* Timestamp and read receipt for text messages */}
            {(!item.attachments || item.attachments.length === 0) && (
              <View style={{ 
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'flex-end',
                marginTop: 4,
                paddingLeft: 4,
                paddingRight: 2,
                backgroundColor: 'transparent',
              }}>
                <Text style={{ 
                  fontSize: 10, 
                  color: isMine ? '#E0E7FF' : '#6B7280',
                  marginRight: 4,
                }}>{timestamp}</Text>
                {/* Show read receipt only for messages we sent */}
                {isMine && (
                  <MessageStatus 
                    readAt={item.read_at} 
                    isDark={isDark}
                    size={12}
                  />
                )}
              </View>
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
  const handleEmojiSelect = (emoji) => {
    setInput(input + emoji.native);
    setShowEmoji(false);
  };

  // Get user avatar initials
  const getUserAvatarInitials = (userName: string | null | undefined) => {
    if (!userName || typeof userName !== 'string') {
      return 'U';
    }
    return userName
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Get last seen time
  const getLastSeenTime = () => {
    if (isOnline) return 'Online';
    
    // Get last seen time from backend data
    // last_seen_at is on the User model, so check user.last_seen_at first
    const lastSeenTimestamp = userInfo?.user?.last_seen_at || 
                               userInfo?.last_seen_at || 
                               userInfo?.last_seen || 
                               userInfo?.lastSeen;
    
    if (lastSeenTimestamp) {
      try {
        const lastSeenDate = new Date(lastSeenTimestamp);
        
        // Check if date is valid
        if (isNaN(lastSeenDate.getTime())) {
          console.warn('Invalid last_seen date:', lastSeenTimestamp);
          return 'Not available';
        }
        
        const now = new Date();
        const diffInMs = now.getTime() - lastSeenDate.getTime();
        const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
        
        if (diffInMinutes < 0) {
          // Future date (shouldn't happen, but handle it)
          return 'Just now';
        }
        
        if (diffInMinutes < 1) return 'Just now';
        if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
        if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
        if (diffInMinutes < 10080) return `${Math.floor(diffInMinutes / 1440)}d ago`;
        return lastSeenDate.toLocaleDateString();
      } catch (error) {
        console.error('Error calculating last seen time:', error);
        return 'Not available';
      }
    }
    
    // Fallback if no last_seen data available
    return 'Not available';
  };

  // Format message date for separators
  const formatMessageDate = (dateString: string | null | undefined) => {
    // Validate date string
    if (!dateString) return 'Today';
    
    const messageDate = new Date(dateString);
    
    // Check if date is invalid
    if (isNaN(messageDate.getTime())) {
      console.warn('Invalid date string for formatMessageDate:', dateString);
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
      } catch (error) {
        console.warn('Error formatting date:', error, dateString);
        return 'Today'; // Default fallback
      }
    }
  };

  const formatMessageTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
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
      console.warn('Invalid date in shouldShowDateSeparator:', {
        current: currentMessage.created_at,
        previous: previousMessage.created_at
      });
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
      <View className={`flex-row items-center p-4 pt-12 border-b ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        {/* User Avatar and Info with Back Button */}
        <TouchableOpacity onPress={() => {
          // Navigate directly to messages tab (root)
          router.replace('/');
        }} className="flex-1 flex-row items-center">
          <MaterialCommunityIcons name="arrow-left" size={24} color={isDark ? '#fff' : '#000'} className="mr-3" />
          
          {/* User Avatar with Online Status */}
          <View className="relative mr-3">
            <UserAvatar
              avatarUrl={userInfo?.avatar_url}
              name={userInfo?.name || `User ${id}`}
              size={48}
            />
            {/* Online/Offline Status Indicator */}
            <View 
              className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 ${
                isDark ? 'border-gray-800' : 'border-white'
              }`}
              style={{ backgroundColor: isOnline ? '#10B981' : '#6B7280' }}
            />
          </View>
          
          {/* User Info */}
          <View className="flex-1">
            <Text className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {userInfo?.name || `User ${id}`}
            </Text>
            <Text className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {getLastSeenTime()}
            </Text>
          </View>
        </TouchableOpacity>
        
        {/* Action Buttons */}
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => Alert.alert('Call', 'Call functionality will be implemented')} className="mr-3">
            <MaterialCommunityIcons name="phone" size={24} color={isDark ? '#fff' : '#000'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Alert.alert('Video Call', 'Video call functionality will be implemented')} className="mr-3">
            <MaterialCommunityIcons name="video" size={24} color={isDark ? '#fff' : '#000'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Alert.alert('User Info', 'User info will be shown here')}>
            <MaterialCommunityIcons name="information-outline" size={24} color={isDark ? '#fff' : '#000'} />
          </TouchableOpacity>
        </View>
      </View>

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
              style={{ flex: 1 }}
              contentContainerStyle={{ 
                padding: 16, 
                paddingBottom: keyboardHeight > 0 ? 20 : 0,
              }}
              inverted={false} // Make sure it's not inverted
              initialScrollIndex={initialScrollIndex}
              onScrollToIndexFailed={(info) => {
                // If scrollToIndex fails, use scrollToEnd as fallback
                console.warn('scrollToIndex failed, using scrollToEnd:', info);
                setTimeout(() => {
                  if (flatListRef.current) {
                    try {
                      flatListRef.current.scrollToEnd({ animated: false });
                    } catch (e) {
                      console.warn('scrollToEnd also failed:', e);
                    }
                  }
                }, 100);
              }}
              onScroll={({ nativeEvent }) => {
                const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
                // Use a threshold instead of exactly 0, as FlatList might not reach exactly 0
                const isAtTop = contentOffset.y <= 50; // Within 50 pixels of the top
                
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
              onContentSizeChange={(contentWidth, contentHeight) => {
                // Scroll whenever content size changes (initial load or new messages)
                if (flatListRef.current && messages.length > 0 && !loadingMore) {
                  requestAnimationFrame(() => {
                    setTimeout(() => {
                      if (flatListRef.current && messages.length > 0) {
                        try {
                          // Use scrollToEnd as primary method - it's more reliable for scrolling to bottom
                          flatListRef.current.scrollToEnd({ animated: false });
                          console.log('Scrolled to bottom via onContentSizeChange (scrollToEnd), contentHeight:', contentHeight);
                          
                          // Also try scrollToOffset with actual content height
                          setTimeout(() => {
                            if (flatListRef.current && contentHeight > 0) {
                              try {
                                flatListRef.current.scrollToOffset({ 
                                  offset: contentHeight,
                                  animated: false
                                });
                                console.log('Scrolled to bottom via onContentSizeChange (scrollToOffset), offset:', contentHeight);
                              } catch (e) {
                                // Ignore - scrollToEnd might have worked
                              }
                            }
                          }, 50);
                          
                          if (!hasScrolledToBottom) {
                            setHasScrolledToBottom(true);
                          }
                        } catch (error) {
                          console.warn('onContentSizeChange scrollToEnd failed:', error);
                          // Fallback: try scrollToOffset with content height
                          try {
                            if (flatListRef.current && contentHeight > 0) {
                              flatListRef.current.scrollToOffset({ 
                                offset: contentHeight,
                                animated: false
                              });
                              if (!hasScrolledToBottom) {
                                setHasScrolledToBottom(true);
                              }
                              console.log('Scrolled to bottom via onContentSizeChange (scrollToOffset fallback), offset:', contentHeight);
                            }
                          } catch (scrollError) {
                            console.warn('onContentSizeChange scroll failed:', scrollError);
                          }
                        }
                      }
                    }, 100);
                  });
                }
              }}
              onLayout={(event) => {
                // Scroll on initial layout if we have messages and aren't loading
                if (flatListRef.current && messages.length > 0 && !loading) {
                  const { height } = event.nativeEvent.layout;
                  console.log('FlatList onLayout, height:', height);
                  
                  const lastMessage = messages[messages.length - 1];
                  const hasImages = lastMessage?.attachments?.some((att: any) => 
                    att.mime?.startsWith('image/') || att.type?.startsWith('image/')
                  );
                  const delay = hasImages ? 600 : 200;
                  
                  // Multiple attempts with increasing delays
                  const layoutScrollAttempts = [delay, delay + 200, delay + 400, delay + 600];
                  layoutScrollAttempts.forEach((attemptDelay, index) => {
                    setTimeout(() => {
                      if (flatListRef.current && messages.length > 0) {
                        try {
                          // Use scrollToEnd as primary method
                          flatListRef.current.scrollToEnd({ animated: false });
                          console.log(`onLayout scroll attempt ${index + 1} (scrollToEnd) at ${attemptDelay}ms`);
                          
                          if (index === layoutScrollAttempts.length - 1 && !hasScrolledToBottom) {
                            setHasScrolledToBottom(true);
                          }
                        } catch (error) {
                          console.warn(`onLayout scroll attempt ${index + 1} failed:`, error);
                          // Last attempt: try scrollToIndex as fallback
                          if (index === layoutScrollAttempts.length - 1) {
                            try {
                              const lastIndex = messages.length - 1;
                              if (lastIndex >= 0 && flatListRef.current) {
                                flatListRef.current.scrollToIndex({ 
                                  index: lastIndex, 
                                  animated: false,
                                  viewPosition: 1
                                });
                                if (!hasScrolledToBottom) {
                                  setHasScrolledToBottom(true);
                                }
                                console.log('Scrolled to bottom via onLayout (scrollToIndex fallback)');
                              }
                            } catch (scrollError) {
                              console.warn('onLayout scroll failed:', scrollError);
                            }
                          }
                        }
                      }
                    }, attemptDelay);
                  });
                }
              }}
              ListEmptyComponent={() => (
                <View style={{ 
                  flex: 1, 
                  justifyContent: 'center', 
                  alignItems: 'center',
                  paddingVertical: 40
                }}>
                  <Text style={{ 
                    color: isDark ? '#9CA3AF' : '#6B7280',
                    fontSize: 16,
                    textAlign: 'center'
                  }}>
                    No messages yet. Start a conversation!
                  </Text>
                </View>
              )}
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
            paddingBottom: Math.max(insets.bottom + 8, keyboardHeight > 0 ? 8 : 16), // Use safe area bottom + padding
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

            {/* Gallery Button (WhatsApp-style) */}
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
    </View>
  );
} 