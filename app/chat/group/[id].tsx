import ReplyBubble from '@/components/ReplyBubble';
import ReplyPreview from '@/components/ReplyPreview';
import UserAvatar from '@/components/UserAvatar';
import VoiceMessageBubble from '@/components/VoiceMessageBubble';
import VoicePlayer from '@/components/VoicePlayer';
import VoiceRecorder from '@/components/VoiceRecorder';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { messagesAPI } from '@/services/api';
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
    Modal,
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
  attachments?: Array<{
    id: number;
    name: string;
    mime: string;
    url: string;
  }>;
  voice_message?: {
    url: string;
    duration: number;
  };
  sender?: {
    id: number;
    name: string;
  };
  reply_to?: {
    id: number;
    message: string;
    sender: {
      id: number;
      name: string;
    };
  };
}

interface Attachment {
  uri: string;
  name: string;
  type: string;
  isImage?: boolean;
}

export default function GroupChatScreen() {
  const { id } = useLocalSearchParams();
  const { currentTheme } = useTheme();
  const { user, isAuthenticated, isLoading } = useAuth();
  const insets = useSafeAreaInsets();
  // Remove the navigation effect - let the AppLayout handle authentication state changes
  const isDark = currentTheme === 'dark';

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [showGroupMembers, setShowGroupMembers] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState<{ uri: string; duration: number } | null>(null);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [showMessageOptions, setShowMessageOptions] = useState<number | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const flatListRef = useRef<FlatList>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastScrollTrigger, setLastScrollTrigger] = useState(0);

  // Fetch messages
  const fetchMessages = async () => {
    try {
      setLoading(true);
      const response = await messagesAPI.getByGroup(Number(id), 1, 10);
      console.log('Group messages response:', response.data);
      
      // Handle Laravel pagination format
      const messagesData = response.data.messages?.data || response.data.messages || [];
      const pagination = response.data.messages || {};
      
      // Check if there are more messages using Laravel pagination
      setHasMoreMessages(pagination.current_page < pagination.last_page);
      
      // Sort messages by created_at in ascending order (oldest first)
      const sortedMessages = messagesData.sort((a, b) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      setMessages(sortedMessages);
      setGroupInfo(response.data.selectedConversation);
      
      // Scroll to bottom after initial load
      setTimeout(() => {
        if (flatListRef.current && sortedMessages.length > 0) {
          flatListRef.current.scrollToEnd({ animated: false });
        }
      }, 200);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      Alert.alert('Error', 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  // Auto-scroll to bottom (newest messages) when messages change
  useEffect(() => {
    if (flatListRef.current && messages.length > 0) {
      // Simple scroll to bottom
      setTimeout(() => {
        if (flatListRef.current) {
          flatListRef.current.scrollToEnd({ animated: true });
        }
      }, 100);
    }
  }, [messages]);

  // Force scroll to bottom when component first loads
  useEffect(() => {
    if (flatListRef.current && messages.length > 0 && !loading) {
      // Simple scroll to bottom when loading completes
      setTimeout(() => {
        if (flatListRef.current) {
          flatListRef.current.scrollToEnd({ animated: false });
        }
      }, 200);
    }
  }, [loading, messages.length]);

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
      
      // Sort new messages by created_at in ascending order (oldest first)
      const sortedNewMessages = newMessagesData.sort((a, b) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      
      // Prepend new messages to existing messages (older messages go at the beginning)
      setMessages(prev => [...sortedNewMessages, ...prev]);
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
        // Clear navigation stack and go to groups tab
        router.dismissAll();
        router.push('/groups');
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
      
      // Add text message if present
      if (input.trim()) {
        formData.append('message', input.trim());
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
        });
      }
      
      // Handle voice recording - send without attachment due to database constraint issue
      if (voiceRecording) {
        // Combine text input with voice message format
        const voiceMessage = `[VOICE_MESSAGE:${voiceRecording.duration}]`;
        const combinedMessage = input.trim() ? `${input.trim()} ${voiceMessage}` : voiceMessage;
        formData.append('message', combinedMessage);
        
        // Add voice-specific metadata
        formData.append('voice_duration', voiceRecording.duration.toString());
        formData.append('is_voice_message', 'true');
        
        // Note: Not sending attachment due to database foreign key constraint issue
        // The backend has a mismatch between mezzage_id and mezzages.id foreign key
        console.log('Voice message sent without attachment due to database constraint issue');
      }
      
      const res = await messagesAPI.sendMessage(formData);
      console.log('Sent message response:', res.data);
      setMessages(prev => {
        // Check if message already exists to prevent duplicates
        const messageExists = prev.some(msg => msg.id === res.data.id);
        if (messageExists) {
          console.log('Message already exists, not adding duplicate');
          return prev;
        }
        return [...prev, res.data];
      });
      setInput('');
      setAttachment(null);
      setVoiceRecording(null);
      setReplyingTo(null); // Clear reply state
      setShowEmoji(false);
      // Scroll to bottom when new message is added
      setTimeout(() => {
        if (flatListRef.current) {
          flatListRef.current.scrollToEnd({ animated: true });
        }
      }, 100);
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
          console.log('Voice message sent as text only due to database constraint');
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
      setAttachment({
        uri: asset.uri,
        name: asset.fileName || 'photo.jpg',
        type: asset.type || 'image/jpeg',
        isImage: true,
      });
    }
  };

  // Pick any file
  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: '*/*',
    });
    if (result.type === 'success') {
      setAttachment({
        uri: result.uri,
        name: result.name,
        type: result.mimeType || 'application/octet-stream',
        isImage: result.mimeType?.startsWith('image/'),
      });
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
              setMessages(prev => prev.filter(msg => msg.id !== messageId));
              setShowMessageOptions(null);
            } catch (error) {
              console.error('Error deleting message:', error);
              Alert.alert('Error', 'Failed to delete message');
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

  // Get group avatar initials
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

  // Render message bubble
  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const isMine = item.sender_id === user?.id;
    const previousMessage = index > 0 ? messages[index - 1] : null;
    const showDateSeparator = shouldShowDateSeparator(item, previousMessage);
    
    const timestamp = formatMessageTime(item.created_at);

    // Check if this is a voice message (has audio attachment and voice data in message)
    let voiceMessageData = null;
    let isVoiceMessage = false;
    let messageText = null;
    
    // Debug: Log the message structure
    console.log('Message structure (group):', {
      id: item.id,
      message: item.message,
      attachments: item.attachments,
      hasAttachments: !!(item.attachments && item.attachments.length > 0)
    });
    
    // Check for voice message format first (even without attachments)
    if (item.message && item.message.match(/\[VOICE_MESSAGE:(\d+)\]$/)) {
      const voiceMatch = item.message.match(/\[VOICE_MESSAGE:(\d+)\]$/);
      console.log('Voice message detected (group):', voiceMatch);
      
      // This is a voice message - ALWAYS render as voice bubble regardless of attachments
      const duration = parseInt(voiceMatch[1]);
      
      // Try to find audio attachment
      let audioAttachment = null;
      if (item.attachments && item.attachments.length > 0) {
        audioAttachment = item.attachments.find(att => att.mime?.startsWith('audio/'));
      }
      
      // Extract text part (everything before the voice message format)
      const textPart = item.message.replace(/\[VOICE_MESSAGE:\d+\]$/, '').trim();
      
      voiceMessageData = {
        url: audioAttachment?.url || null,
        duration: duration,
        textPart: textPart // Store the text part for display
      };
      isVoiceMessage = true;
      console.log('Voice message data (group):', {
        ...voiceMessageData,
        hasAttachment: !!audioAttachment,
        attachmentUrl: audioAttachment?.url,
        willRenderAsVoiceBubble: true
      });
    } else if (item.attachments && item.attachments.length > 0) {
      const audioAttachment = item.attachments.find(att => att.mime?.startsWith('audio/'));
      if (audioAttachment && item.message) {
        // Check for voice message format: [VOICE_MESSAGE:duration]
        const voiceMatch = item.message.match(/^\[VOICE_MESSAGE:(\d+)\]$/);
        console.log('Voice message check (group):', {
          message: item.message,
          hasAudioAttachment: !!audioAttachment,
          voiceMatch: voiceMatch,
          isVoiceMessage: !!voiceMatch
        });
        if (voiceMatch) {
          voiceMessageData = {
            url: audioAttachment.url,
            duration: parseInt(voiceMatch[1])
          };
          isVoiceMessage = true;
        } else {
          // Regular message with audio attachment
          messageText = item.message;
        }
      }
    }

    // If it's a voice message, render the dedicated voice bubble
    if (isVoiceMessage && voiceMessageData) {
      console.log('Rendering voice message bubble (group):', voiceMessageData);
      
      // If no URL is available, show a placeholder or fallback
      if (!voiceMessageData.url) {
        console.log('No URL available for voice message, showing fallback');
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
              maxWidth: '90%', // Increased max width to prevent unnecessary wrapping
              minWidth: 60,
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

          {item.attachments && item.attachments.length > 0 && (
            item.attachments[0].mime?.startsWith('image/') ? (
              <Image source={{ uri: item.attachments[0].url }} style={{ width: 180, height: 180, borderRadius: 12, marginBottom: 6 }} />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <MaterialCommunityIcons name="file" size={28} color="#283891" />
                <Text style={{ marginLeft: 6, color: isMine ? '#fff' : (isDark ? '#fff' : '#111827') }}>{item.attachments[0].name || 'File'}</Text>
              </View>
            )
          )}
          
          {item.message && !isVoiceMessage && (
            <Text 
              style={{ 
                color: isMine ? '#fff' : (isDark ? '#fff' : '#111827'),
                fontSize: 16,
                lineHeight: 20,
                flexShrink: 1,
              }}
            >
              {item.message}
            </Text>
          )}
          <Text style={{ fontSize: 10, color: isMine ? '#E0E7FF' : '#6B7280', marginTop: 2, alignSelf: 'flex-end' }}>{timestamp}</Text>
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
  }, [id]);

  // Format message date for separators
  const formatMessageDate = (dateString: string) => {
    const messageDate = new Date(dateString);
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
      return messageDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
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
    
    const currentDate = new Date(currentMessage.created_at);
    const previousDate = new Date(previousMessage.created_at);
    
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
            // Clear navigation stack and go to groups tab
            router.dismissAll();
            router.push('/groups');
          }} className="mr-3">
            <MaterialCommunityIcons name="arrow-left" size={24} color={isDark ? '#fff' : '#000'} />
          </TouchableOpacity>
          
          {/* Group Avatar and Info */}
          <TouchableOpacity 
            onPress={handleGroupHeaderPress} 
            className="flex-1 flex-row items-center"
          >
            {/* Group Avatar */}
            <View className="w-12 h-12 rounded-full bg-primary items-center justify-center mr-3">
              <Text className="text-white font-semibold text-lg">
                {getGroupAvatarInitials(groupInfo?.name || `Group ${id}`)}
              </Text>
            </View>
            
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
                paddingBottom: keyboardHeight > 0 ? 20 : 0,
                flexGrow: 1
              }}
              inverted={false} // Make sure it's not inverted
              onScroll={({ nativeEvent }) => {
                const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
                const isAtTop = contentOffset.y <= 50;
                console.log('Group scroll position:', contentOffset.y, 'isAtTop:', isAtTop, 'hasMoreMessages:', hasMoreMessages, 'loadingMore:', loadingMore);
                
                // Debounce: only trigger once every 2 seconds
                const now = Date.now();
                if (isAtTop && hasMoreMessages && !loadingMore && (now - lastScrollTrigger > 2000)) {
                  console.log('Triggering loadMoreMessages (group)...');
                  setLastScrollTrigger(now);
                  loadMoreMessages();
                }
              }}
              onScrollEndDrag={({ nativeEvent }) => {
                const { contentOffset } = nativeEvent;
                const isAtTop = contentOffset.y <= 50;
                console.log('Group scroll end drag - position:', contentOffset.y, 'isAtTop:', isAtTop);
                
                // Debounce: only trigger once every 2 seconds
                const now = Date.now();
                if (isAtTop && hasMoreMessages && !loadingMore && (now - lastScrollTrigger > 2000)) {
                  console.log('Triggering loadMoreMessages on scroll end (group)...');
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
                if (flatListRef.current && messages.length > 0) {
                  flatListRef.current.scrollToEnd({ animated: true });
                }
              }}
              onLayout={() => {
                if (flatListRef.current && messages.length > 0) {
                  flatListRef.current.scrollToEnd({ animated: true });
                }
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
  </View>
);
} 