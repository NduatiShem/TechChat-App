import LinkText from '@/components/LinkText';
import MessageStatus from '@/components/MessageStatus';
import ReplyBubble from '@/components/ReplyBubble';
import ReplyPreview from '@/components/ReplyPreview';
import UserAvatar from '@/components/UserAvatar';
import VideoPlayer from '@/components/VideoPlayer';
import VoiceMessageBubble from '@/components/VoiceMessageBubble';
import VoicePlayer from '@/components/VoicePlayer';
import VoiceRecorder from '@/components/VoiceRecorder';
import { AppConfig } from '@/config/app.config';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useTheme } from '@/context/ThemeContext';
import { messagesAPI, usersAPI } from '@/services/api';
import { deleteMessage as deleteDbMessage, fixDuplicateMessagesWithWrongTimestamps, getDb, getMessages as getDbMessages, hasMessagesForConversation, initDatabase, saveMessages as saveDbMessages, updateMessageByServerId, updateMessageStatus } from '@/services/database';
import { startRetryService, retryPendingMessages } from '@/services/messageRetryService';
import { syncConversationMessages, syncOlderMessages } from '@/services/syncService';
import { isVideoAttachment } from '@/utils/textUtils';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Picker } from 'emoji-mart-native';
import NetInfo from '@react-native-community/netinfo';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, StatusBar, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const options = ({ params }: { params: any }) => ({
  headerShown: false, // Hide the default header, use custom header instead
});

interface Message {
  id: number;
  message: string;
  sender_id: number;
  receiver_id?: number;
  group_id?: number;
  created_at: string;
  read_at?: string | null;
  edited_at?: string | null;
  sync_status?: 'synced' | 'pending' | 'failed';
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
    };
    attachments?: {
      id: number;
      name: string;
      mime: string;
      url: string;
    }[];
    created_at: string;
  };
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

export default function UserChatScreen() {
  const { id } = useLocalSearchParams();
  const { currentTheme } = useTheme();
  const { user } = useAuth();
  const { updateUnreadCount, setActiveConversation, clearActiveConversation } = useNotifications();
  const insets = useSafeAreaInsets();
  const ENABLE_MARK_AS_READ = true; // Enable mark as read functionality
  const ENABLE_DELETE_MESSAGE = true; // Enable delete - route exists
  
  // Remove the navigation effect - let the AppLayout handle authentication state changes
  const isDark = currentTheme === 'dark';
  const [messages, setMessages] = useState<Message[]>([]);
  
  // Robust deduplication function using composite key (ID + created_at + message content)
  const deduplicateMessages = useCallback((messagesArray: Message[]): Message[] => {
    // Use a Map with composite key: "id_createdAt_messageContent" for more robust deduplication
    const seenMessages = new Map<string, Message>();
    const seenById = new Map<number | string, Message>();
    
    for (const msg of messagesArray) {
      if (!msg) continue;
      
      // Primary deduplication: Check by ID first
      if (msg.id !== undefined && msg.id !== null && msg.id !== 0) {
        const existingById = seenById.get(msg.id);
        
        if (existingById) {
          // Same ID exists - prefer the one with synced status or more complete data
          const existingIsBetter = 
            (existingById.sync_status === 'synced' && msg.sync_status !== 'synced') ||
            (existingById.attachments && !msg.attachments) ||
            (existingById.reply_to && !msg.reply_to);
          
          if (!existingIsBetter) {
            // Replace with newer/better version
            seenById.set(msg.id, msg);
            // Also update in seenMessages if it exists there
            const messageKey = `${msg.id}_${msg.created_at}_${msg.message || ''}`;
            seenMessages.set(messageKey, msg);
          }
          continue; // Skip to next message
        }
        
        // New ID, add it
        seenById.set(msg.id, msg);
        // CRITICAL FIX: Also add to seenMessages immediately so content+sender check can find it
        const messageKey = `${msg.id}_${msg.created_at}_${msg.message || ''}`;
        seenMessages.set(messageKey, msg);
      }
      
      // Secondary deduplication: Check by content+sender for messages with same content
      // This handles cases where same message has different IDs (tempLocalId vs server_id)
      // and different timestamps (local vs server timestamp)
      const messageContent = msg.message || '';
      const messageTime = new Date(msg.created_at).getTime();
      const senderId = msg.sender_id;
      
      // CRITICAL FIX: Check BOTH seenById AND seenMessages for content+sender duplicates
      // This ensures we catch duplicates even if one is in seenById and one is in seenMessages
      let foundDuplicate = false;
      
      // First check seenById for duplicates (messages with IDs)
      for (const existing of seenById.values()) {
        if (existing.id === msg.id) continue; // Skip self
        const existingTime = new Date(existing.created_at).getTime();
        const timeDiff = Math.abs(existingTime - messageTime);
        const contentMatch = (existing.message || '') === messageContent;
        const senderMatch = existing.sender_id === senderId;
        
        if (contentMatch && senderMatch) {
          const msgHasServerId = msg.id && typeof msg.id === 'number' && msg.id < 1000000000000;
          const existingHasServerId = existing.id && typeof existing.id === 'number' && existing.id < 1000000000000;
          
          // Case 1: Both have server_id - match regardless of timestamp
          if (msgHasServerId && existingHasServerId) {
            // Prefer the one with better sync status or newer timestamp
            if (msg.sync_status === 'synced' && existing.sync_status !== 'synced') {
              seenById.delete(existing.id);
              seenById.set(msg.id, msg);
              const existingKey = `${existing.id}_${existing.created_at}_${messageContent}`;
              const newKey = `${msg.id}_${msg.created_at}_${messageContent}`;
              seenMessages.delete(existingKey);
              seenMessages.set(newKey, msg);
            } else if (messageTime > existingTime && msg.sync_status === 'synced') {
              seenById.delete(existing.id);
              seenById.set(msg.id, msg);
              const existingKey = `${existing.id}_${existing.created_at}_${messageContent}`;
              const newKey = `${msg.id}_${msg.created_at}_${messageContent}`;
              seenMessages.delete(existingKey);
              seenMessages.set(newKey, msg);
            }
            foundDuplicate = true;
            break;
          }
          
          // Case 2: One has tempLocalId, one has server_id - match if within 10 minutes
          if ((msgHasServerId && !existingHasServerId) || (!msgHasServerId && existingHasServerId)) {
            if (timeDiff < 600000) { // 10 minutes window
              // Prefer the one with server_id (synced)
              if (msg.sync_status === 'synced' && existing.sync_status !== 'synced') {
                seenById.delete(existing.id);
                seenById.set(msg.id, msg);
                const existingKey = `${existing.id}_${existing.created_at}_${messageContent}`;
                const newKey = `${msg.id}_${msg.created_at}_${messageContent}`;
                seenMessages.delete(existingKey);
                seenMessages.set(newKey, msg);
              }
              foundDuplicate = true;
              break;
            }
          }
          
          // Case 3: Both have tempLocalId - match if within 5 seconds
          if (!msgHasServerId && !existingHasServerId) {
            if (timeDiff < 5000) {
              if (msg.sync_status === 'synced' && existing.sync_status !== 'synced') {
                seenById.delete(existing.id);
                seenById.set(msg.id, msg);
                const existingKey = `${existing.id}_${existing.created_at}_${messageContent}`;
                const newKey = `${msg.id}_${msg.created_at}_${messageContent}`;
                seenMessages.delete(existingKey);
                seenMessages.set(newKey, msg);
              }
              foundDuplicate = true;
              break;
            }
          }
        }
      }
      
      // Then check seenMessages for duplicates (if not found in seenById)
      if (!foundDuplicate) {
        for (const [key, existing] of seenMessages.entries()) {
          const existingTime = new Date(existing.created_at).getTime();
          const timeDiff = Math.abs(existingTime - messageTime);
          const contentMatch = (existing.message || '') === messageContent;
          const senderMatch = existing.sender_id === senderId;
          
          // CRITICAL FIX: For messages with same content+sender, check if they're duplicates
          // regardless of timestamp if:
          // 1. Both have server_id (synced messages) - match by content+sender only
          // 2. One has tempLocalId and one has server_id - match if within reasonable time window
          if (contentMatch && senderMatch) {
            const msgHasServerId = msg.id && typeof msg.id === 'number' && msg.id < 1000000000000;
            const existingHasServerId = existing.id && typeof existing.id === 'number' && existing.id < 1000000000000;
            
            // Case 1: Both have server_id - match regardless of timestamp (they're the same message)
            if (msgHasServerId && existingHasServerId) {
              // Same content, same sender, both synced - they're duplicates
              // Prefer the one with more recent timestamp or better sync status
              if (msg.sync_status === 'synced' && existing.sync_status !== 'synced') {
                seenMessages.delete(key);
                const newKey = `${msg.id}_${msg.created_at}_${messageContent}`;
                seenMessages.set(newKey, msg);
                if (existing.id && seenById.has(existing.id)) {
                  seenById.delete(existing.id);
                  seenById.set(msg.id, msg);
                }
              } else if (messageTime > existingTime && msg.sync_status === 'synced') {
                // Prefer newer timestamp if both are synced
                seenMessages.delete(key);
                const newKey = `${msg.id}_${msg.created_at}_${messageContent}`;
                seenMessages.set(newKey, msg);
                if (existing.id && seenById.has(existing.id)) {
                  seenById.delete(existing.id);
                  seenById.set(msg.id, msg);
                }
              }
              foundDuplicate = true;
              break;
            }
            
            // Case 2: One has tempLocalId, one has server_id - match if within 10 minutes
            // (allows for network delays and clock differences)
            if ((msgHasServerId && !existingHasServerId) || (!msgHasServerId && existingHasServerId)) {
              if (timeDiff < 600000) { // 10 minutes window
                // Prefer the one with server_id (synced) over tempLocalId (pending)
                if (msg.sync_status === 'synced' && existing.sync_status !== 'synced') {
                  seenMessages.delete(key);
                  const newKey = `${msg.id}_${msg.created_at}_${messageContent}`;
                  seenMessages.set(newKey, msg);
                  if (existing.id && seenById.has(existing.id)) {
                    seenById.delete(existing.id);
                    seenById.set(msg.id, msg);
                  }
                }
                foundDuplicate = true;
                break;
              }
            }
            
            // Case 3: Both have tempLocalId - match if within 5 seconds (same send attempt)
            if (!msgHasServerId && !existingHasServerId) {
              if (timeDiff < 5000) {
                // Prefer the one with better sync status
                if (msg.sync_status === 'synced' && existing.sync_status !== 'synced') {
                  seenMessages.delete(key);
                  const newKey = `${msg.id}_${msg.created_at}_${messageContent}`;
                  seenMessages.set(newKey, msg);
                  if (existing.id && seenById.has(existing.id)) {
                    seenById.delete(existing.id);
                    seenById.set(msg.id, msg);
                  }
                }
                foundDuplicate = true;
                break;
              }
            }
          }
        }
      }
      
      // Only add to seenMessages if not already added (messages with IDs are already added above)
      if (!foundDuplicate && (!msg.id || msg.id === undefined || msg.id === null || msg.id === 0)) {
        // Create composite key for deduplication (only for messages without IDs)
        const messageKey = `${msg.created_at}_${messageContent}_${senderId}`;
        seenMessages.set(messageKey, msg);
      }
    }
    
    // FIX: Combine both seenById and seenMessages, prioritizing seenById
    // This ensures we don't lose messages that might not have IDs yet
    const allUniqueMessages = new Map<number | string, Message>();
    
    // First, add all messages from seenById (has priority - these have IDs)
    for (const msg of seenById.values()) {
      allUniqueMessages.set(msg.id, msg);
    }
    
    // Then, add messages from seenMessages that don't have IDs or weren't in seenById
    for (const msg of seenMessages.values()) {
      if (msg.id) {
        // If it has an ID but wasn't in seenById, add it (shouldn't happen, but safety)
        if (!allUniqueMessages.has(msg.id)) {
          allUniqueMessages.set(msg.id, msg);
        }
      } else {
        // Message without ID - use composite key
        const key = `temp_${msg.created_at}_${msg.message || ''}_${msg.sender_id}`;
        if (!allUniqueMessages.has(key)) {
          allUniqueMessages.set(key, msg);
        }
      }
    }
    
    // Sort by created_at
    return Array.from(allUniqueMessages.values()).sort((a: Message, b: Message) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, []);
  
  // FIXED: Use ref-based approach to prevent infinite loops and race conditions
  const prevMessagesLengthRef = useRef<number>(0);
  const isDeduplicatingRef = useRef<boolean>(false);
  
  useEffect(() => {
    // Only deduplicate if:
    // 1. Messages length changed (might indicate duplicates)
    // 2. Not already deduplicating (prevent race conditions)
    // 3. We have messages
    if (messages.length > 0 && 
        messages.length !== prevMessagesLengthRef.current && 
        !isDeduplicatingRef.current) {
      
      isDeduplicatingRef.current = true;
      const deduplicated = deduplicateMessages(messages);
      
      if (deduplicated.length !== messages.length) {
        if (__DEV__) {
          console.log(`[UserChat] Deduplication safety net: Removed ${messages.length - deduplicated.length} duplicate messages`);
        }
        prevMessagesLengthRef.current = deduplicated.length;
        setMessages(deduplicated);
      } else {
        prevMessagesLengthRef.current = messages.length;
      }
      
      // Reset flag after a short delay to allow state updates
      setTimeout(() => {
        isDeduplicatingRef.current = false;
      }, 100);
    } else if (messages.length === prevMessagesLengthRef.current) {
      // Length didn't change, update ref
      prevMessagesLengthRef.current = messages.length;
    }
  }, [messages.length, deduplicateMessages]); // Only depend on length, not full array
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null); // { uri, name, type, isImage }
  const [userInfo, setUserInfo] = useState<any>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState<{ uri: string; duration: number } | null>(null);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [showImagePreview, setShowImagePreview] = useState<string | null>(null);
  const [showMessageOptions, setShowMessageOptions] = useState<number | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editText, setEditText] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const flatListRef = useRef<FlatList<Message>>(null);
  const hasScrolledForThisConversation = useRef<string | null>(null); // Track which conversation we've scrolled for
  
  // Background retry state - track retry attempts and timeout
  const retryAttemptRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messagesLengthRef = useRef<number>(0); // Track messages length for retry logic
  const isPaginatingRef = useRef<boolean>(false); // Track if user is currently paginating (loading older messages)
  const lastFocusTimeRef = useRef<number>(0); // Track when screen last gained focus
  
  // Background polling state - for checking new messages
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const latestMessageIdRef = useRef<number | null>(null); // Track latest message ID to detect new messages
  const isPollingRef = useRef<boolean>(false); // Track if polling is active
  const POLLING_INTERVAL = 3000; // Poll every 3 seconds
  const MAX_RETRY_ATTEMPTS = 5; // Maximum retry attempts
  const INITIAL_RETRY_DELAY = 1000; // Start with 1 second delay
  
  // Scroll management refs
  const userScrolledRef = useRef<boolean>(false); // Track if user manually scrolled
  const isInitialLoadRef = useRef<boolean>(true); // Track if this is the initial load
  const lastScrollOffsetRef = useRef<number>(0); // Track last scroll offset to detect user scrolling
  const shouldAutoScrollRef = useRef<boolean>(true); // Flag to determine if auto-scroll should happen
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Debounced scroll timeout to prevent multiple rapid scrolls
  const contentSizeRef = useRef<{ width: number; height: number } | null>(null); // Track content size
  const viewportSizeRef = useRef<{ width: number; height: number } | null>(null); // Track viewport size
  const hasAttemptedInitialScrollRef = useRef<boolean>(false); // Track if we've attempted initial scroll
  const hasFetchedForConversationRef = useRef<string | null>(null); // Track which conversation we've fetched for
  const needsMarkAsReadRef = useRef<boolean>(false); // Track if mark-read needs retry when network comes back
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastScrollTrigger, setLastScrollTrigger] = useState(0);
  const [dbInitialized, setDbInitialized] = useState(false);
  const [loadedMessagesCount, setLoadedMessagesCount] = useState(0);
  const MESSAGES_PER_PAGE = 50; // Load 50 messages at a time

  // Initialize database on mount
  useEffect(() => {
    let mounted = true;
    const initDb = async () => {
      try {
        await initDatabase();
        if (mounted) {
          setDbInitialized(true);
        }
      } catch (error) {
        console.error('[UserChat] Failed to initialize database:', error);
        if (mounted) {
          setDbInitialized(true); // Still allow app to work
        }
      }
    };
    initDb();
    return () => {
      mounted = false;
    };
  }, []);

  // Debug: Log when userInfo changes
  useEffect(() => {
    // UserInfo state changed
  }, [userInfo]);

  // Load messages from local database first (instant display)
  const loadMessagesFromDb = useCallback(async (limit: number = MESSAGES_PER_PAGE, offset: number = 0): Promise<Message[]> => {
    try {
      if (!dbInitialized) return [];
      
      const dbMessages = await getDbMessages(Number(id), 'individual', limit, offset);
      
      // Transform database format to UI format
      return dbMessages.map(msg => ({
        id: msg.server_id || msg.id,
        message: msg.message || '',
        sender_id: msg.sender_id,
        receiver_id: msg.receiver_id,
        group_id: msg.group_id,
        created_at: msg.created_at,
        read_at: msg.read_at,
        edited_at: msg.edited_at,
        sync_status: msg.sync_status, // Include sync_status for tick display
        attachments: msg.attachments?.map(att => ({
          id: att.server_id || att.id,
          name: att.name,
          mime: att.mime,
          url: att.url,
          size: att.size,
          type: att.type,
        })),
        reply_to: msg.reply_to,
        sender: msg.sender, // Include sender info if available
      }));
    } catch (error) {
      console.error('[UserChat] Error loading messages from database:', error);
      return [];
    }
  }, [id, dbInitialized]);

  // Fetch messages and user info
  const fetchMessages = useCallback(async (showLoading = true) => {
    // Only reset scroll flag if this is initial load or user hasn't scrolled away
    // This prevents unwanted scrolls when refreshing content while user is viewing older messages
    if (isInitialLoadRef.current || (!userScrolledRef.current && shouldAutoScrollRef.current)) {
      setHasScrolledToBottom(false);
    }
    
    // STEP 1: Show cached data instantly (if available) - NO loading spinner
    if (dbInitialized) {
      try {
        const cachedMessages = await loadMessagesFromDb(MESSAGES_PER_PAGE, 0);
        if (cachedMessages.length > 0) {
          const sortedMessages = cachedMessages.sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          const uniqueMessages = deduplicateMessages(sortedMessages);
          setMessages(uniqueMessages);
          setLoadedMessagesCount(uniqueMessages.length);
          
          if (uniqueMessages.length > 0) {
            const latestMsg = uniqueMessages[uniqueMessages.length - 1];
            latestMessageIdRef.current = latestMsg.id;
          }
          
          // Don't set loading to false yet - we'll fetch fresh data
        } else {
          // No cache available - show loading spinner
          if (showLoading) {
            setLoading(true);
          }
        }
      } catch (cacheError) {
        // If cache load fails, show loading spinner
        if (showLoading) {
          setLoading(true);
        }
      }
    } else {
      // Database not initialized - show loading spinner
      if (showLoading) {
        setLoading(true);
      }
    }
    
    // STEP 2: Fetch from API in parallel (always) - API is source of truth
    try {
      // Fetch more messages (50) to match syncConversationMessages and ensure all messages are loaded
      const res = await messagesAPI.getByUser(Number(id), 1, 50);
      
      // Handle Laravel pagination format
      const messagesData = res.data.messages?.data || res.data.messages || [];
      const pagination = res.data.messages || {};
      
      // Debug each message's attachments
      messagesData.forEach((message: any, index: number) => {
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
      const sortedMessages = processedMessages.sort((a: Message, b: Message) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      
      // Deduplicate messages before setting state
      const uniqueMessages = deduplicateMessages(sortedMessages);
      
      // Find the newest message index for initial scroll
      const newestMessageId = pagination.newest_message_id;
      
      // If we have newest_message_id, find its index after sorting
      if (newestMessageId) {
        const newestIndex = uniqueMessages.findIndex((msg: Message) => msg.id === newestMessageId);
        if (newestIndex >= 0) {
          console.log('Found newest message at index:', newestIndex, 'ID:', newestMessageId);
        } else {
          console.log('Newest message ID not found in sorted messages, using last index');
        }
      }
      
      // Save messages to database
      if (dbInitialized) {
        try {
          const messagesToSave = uniqueMessages.map((msg: any) => ({
            server_id: msg.id,
            conversation_id: Number(id),
            conversation_type: 'individual' as const,
            sender_id: msg.sender_id,
            receiver_id: msg.receiver_id,
            message: msg.message,
            created_at: msg.created_at,
            read_at: msg.read_at,
            edited_at: msg.edited_at,
            reply_to_id: msg.reply_to_id,
            sync_status: 'synced' as const,
            attachments: msg.attachments,
          }));
          await saveDbMessages(messagesToSave);
          
          // Fix existing duplicates with wrong timestamps after saving
          try {
            await fixDuplicateMessagesWithWrongTimestamps(
              Number(id),
              'individual',
              uniqueMessages.map((msg: any) => ({
                id: msg.id,
                created_at: msg.created_at,
                message: msg.message,
                sender_id: msg.sender_id,
              }))
            );
          } catch (cleanupError) {
            // Silently fail - cleanup is not critical
            if (__DEV__) {
              console.warn('[UserChat] Error cleaning up duplicates after save:', cleanupError);
            }
          }
          
          if (__DEV__) {
            console.log(`[UserChat] Saved ${messagesToSave.length} messages to database from API sync`);
          }
        } catch (dbError) {
          console.error('[UserChat] Error saving messages to database:', dbError);
        }
      }
      
      // Only update UI if we didn't already load from DB (to avoid flicker)
      if (!dbInitialized || messages.length === 0) {
        // Ensure all messages have sync_status (default to 'synced' for API messages)
        const messagesWithStatus = uniqueMessages.map(msg => ({
          ...msg,
          sync_status: msg.sync_status || 'synced' as const,
        }));
        setMessages(messagesWithStatus);
        messagesLengthRef.current = messagesWithStatus.length;
      } else {
        // Reload from DB to get merged data (includes sync_status)
        // CRITICAL FIX: When merging DB messages with prev state, check for duplicates by server_id
        // This prevents duplicates when polling has already added messages to state
        const mergedMessages = await loadMessagesFromDb(MESSAGES_PER_PAGE, 0);
        
        if (mergedMessages.length > 0) {
          const sorted = mergedMessages.sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          
          // CRITICAL FIX: Merge DB messages with prev state, but deduplicate by server_id
          // This prevents duplicates when polling has already added messages to state
          setMessages(prev => {
            // Create a Set of server_ids from DB messages for fast lookup
            const dbServerIds = new Set(sorted.map(msg => msg.id).filter(id => id != null));
            
            // CRITICAL FIX: Filter out messages from prev that are already in DB by server_id
            // This handles the case where polling added messages that are now in DB
            const prevMessagesNotInDb = prev.filter(msg => {
              // If message has a server_id, check if it's already in DB
              if (msg.id && typeof msg.id === 'number' && msg.id < 1000000000000) {
                // This is a synced message - exclude it if it's already in DB
                return !dbServerIds.has(msg.id);
              }
              
              // If message has tempLocalId (pending), check if it matches a DB message
              if (msg.sync_status === 'pending' && 
                  typeof msg.id === 'number' && 
                  msg.id > 1000000000000) {
                // Check if this pending message matches a DB message by content+sender
                const matchesDb = sorted.some(dbMsg => {
                  const timeDiff = Math.abs(
                    new Date(dbMsg.created_at).getTime() - new Date(msg.created_at).getTime()
                  );
                  const messageMatch = (dbMsg.message || '') === (msg.message || '');
                  const senderMatch = dbMsg.sender_id === msg.sender_id;
                  
                  return messageMatch && senderMatch && timeDiff < 10000; // 10 second window
                });
                
                return !matchesDb; // Only keep if it doesn't match a DB message
              }
              
              // Keep other pending messages
              return msg.sync_status === 'pending';
            });
            
            // Combine: DB messages (source of truth) + prev messages not in DB
            const allMessages = [...sorted, ...prevMessagesNotInDb];
            const sortedAll = allMessages.sort((a, b) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            
            // CRITICAL: Deduplicate by server_id first, then by content+timestamp
            const deduplicated = deduplicateMessages(sortedAll);
            messagesLengthRef.current = deduplicated.length;
            return deduplicated;
          });
        } else {
          // No DB messages, but preserve pending messages
          setMessages(prev => {
            const pendingMessages = prev.filter(msg => 
              msg.sync_status === 'pending' || 
              (msg.sync_status !== 'synced' && typeof msg.id === 'number' && msg.id > 1000000000000)
            );
            if (pendingMessages.length > 0) {
              messagesLengthRef.current = pendingMessages.length;
              return pendingMessages;
            }
            return prev;
          });
        }
      }
      
      // Set latest message ID for tracking
      setMessages(current => {
        if (current.length > 0) {
          const latestMsg = current[current.length - 1];
          latestMessageIdRef.current = latestMsg.id;
        }
        return current; // Don't modify state, just use it for side effects
      });
      
      setUserInfo(res.data.selectedConversation);
      
      // Set loading to false - scroll will happen after content is rendered
      if (showLoading) {
        setLoading(false);
      }
      
      // Only reset scroll flag if this is initial load or user is at bottom
      // This prevents unwanted scrolls when refreshing while user is viewing older messages
      if (isInitialLoadRef.current || (!userScrolledRef.current && shouldAutoScrollRef.current)) {
        setHasScrolledToBottom(false);
      }
      
      // Mark messages as read when user opens conversation
      // Use the new route: PUT /api/messages/mark-read/{userId}
      if (ENABLE_MARK_AS_READ) {
        try {
          await messagesAPI.markMessagesAsRead(Number(id));
          // Update unread count to 0 for this conversation - this will update badge
          updateUnreadCount(Number(id), 0);
        } catch (error: any) {
          // Handle errors gracefully - don't show to user
          const statusCode = error?.response?.status;
          
          // 429 = Too Many Requests (rate limit) - expected, handled gracefully
          // 422 = Validation error - expected in some cases
          // 404 = Not found - endpoint might not exist yet
          // Only log unexpected errors in development
          if (statusCode !== 429 && statusCode !== 422 && statusCode !== 404) {
            if (__DEV__) {
              console.log('markMessagesAsRead failed:', statusCode || error?.message || error);
            }
          }
          // Silently ignore rate limit and validation errors
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
      
      // Successfully fetched - reset retry attempts
      retryAttemptRef.current = 0;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    } catch (error: any) {
      console.error('[UserChat] API fetch failed:', error);
      
      // STEP 3: If API fails and we have cache, keep showing cache
      // Cache is already displayed in STEP 1, so we just need to ensure loading is off
      const hasCachedMessages = messagesLengthRef.current > 0;
      
      if (showLoading) {
        setLoading(false);
      }
      
      // If we have cached messages, keep them displayed (already shown in STEP 1)
      if (!hasCachedMessages) {
        // No cache and API failed - try loading from cache one more time as fallback
        if (dbInitialized) {
          try {
            const fallbackMessages = await loadMessagesFromDb(MESSAGES_PER_PAGE, 0);
            if (fallbackMessages.length > 0) {
              const sortedMessages = fallbackMessages.sort((a, b) => 
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
              const uniqueMessages = deduplicateMessages(sortedMessages);
              setMessages(uniqueMessages);
              setLoadedMessagesCount(uniqueMessages.length);
              
              if (uniqueMessages.length > 0) {
                const latestMsg = uniqueMessages[uniqueMessages.length - 1];
                latestMessageIdRef.current = latestMsg.id;
              }
            } else {
              // No cache available - show empty state
              setMessages([]);
            }
          } catch (cacheError) {
            console.error('[UserChat] Error loading from cache fallback:', cacheError);
            setMessages([]);
          }
        } else {
          // No database - show empty state
          setMessages([]);
        }
      }
      
      // Check if this is a network-related error that we should retry
      const isNetworkError = 
        !error.response || // No response (network error)
        error.code === 'ECONNABORTED' || // Timeout
        error.message?.includes('Network Error') ||
        error.message?.includes('timeout') ||
        error.response?.status >= 500; // Server errors (500, 502, 503, etc.)
      
      // Only retry network errors, not auth errors (401) or client errors (400, 404)
      const shouldRetry = isNetworkError && 
                         retryAttemptRef.current < MAX_RETRY_ATTEMPTS &&
                         !showLoading; // Don't retry if user is waiting for initial load
      
      if (shouldRetry) {
        // Calculate exponential backoff delay: 1s, 2s, 4s, 8s, 16s
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryAttemptRef.current);
        retryAttemptRef.current += 1;
        
        if (__DEV__) {
          console.log(`[UserChat] Retrying fetchMessages (attempt ${retryAttemptRef.current}/${MAX_RETRY_ATTEMPTS}) in ${delay}ms`);
        }
        
        // Retry in background without showing loading spinner
        retryTimeoutRef.current = setTimeout(() => {
          fetchMessages(false); // Don't show loading spinner for retries
        }, delay);
      } else {
        // Max retries reached or non-retryable error
        if (retryAttemptRef.current >= MAX_RETRY_ATTEMPTS) {
          if (__DEV__) {
            console.warn('[UserChat] Max retry attempts reached. Stopping background retries.');
          }
        }
        
        // Log error for debugging (only in dev mode)
        if (__DEV__) {
          console.error('[UserChat] Failed to fetch messages:', {
            error: error.message,
            status: error.response?.status,
            retryAttempts: retryAttemptRef.current,
            hasCachedMessages
          });
        }
      }
    }
    }, [id, updateUnreadCount, ENABLE_MARK_AS_READ]);

  // Update messages length ref when messages change
  useEffect(() => {
    messagesLengthRef.current = messages.length;
    // Update latest message ID when messages change
    if (messages.length > 0) {
      const latestMsg = messages[messages.length - 1];
      latestMessageIdRef.current = latestMsg.id;
    }
  }, [messages.length]);
  
  // Background polling for new messages - silent, non-intrusive
  const pollForNewMessages = useCallback(async () => {
    // Don't poll if:
    // 1. Already polling (prevent concurrent polls)
    // 2. User is loading more messages (pagination)
    // 3. User is sending a message
    // 4. No latest message ID tracked yet
    if (
      isPollingRef.current ||
      loadingMore ||
      isPaginatingRef.current ||
      sending ||
      !latestMessageIdRef.current
    ) {
      return;
    }

    isPollingRef.current = true;
    try {
      // Fetch latest messages (page 1) silently
      const res = await messagesAPI.getByUser(Number(id), 1, 10);
      const messagesData = res.data.messages?.data || res.data.messages || [];
      
      if (messagesData.length === 0) {
        isPollingRef.current = false;
        return;
      }

      // Sort messages to find the newest
      const sortedNewMessages = messagesData.sort((a: Message, b: Message) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      
      const newestMessage = sortedNewMessages[sortedNewMessages.length - 1];
      
      // Check if we have new messages (newer than our latest)
      if (newestMessage.id > latestMessageIdRef.current) {
        // Find all new messages (those with ID > latestMessageIdRef.current)
        const newMessages = sortedNewMessages.filter((msg: Message) => 
          msg.id > latestMessageIdRef.current!
        );
        
        if (newMessages.length > 0) {
          // Process new messages to ensure reply_to data is structured
          const processedNewMessages = newMessages.map((msg: any) => {
            if (msg.reply_to) {
              return msg;
            }
            
            if (msg.reply_to_id) {
              // Try to find replied message in existing messages or new messages
              const allMessages = [...messages, ...newMessages];
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
          
          // Add new messages to existing messages (append at end, they're already sorted)
          setMessages(prev => {
            // Check for duplicates before adding
            const existingIds = new Set(prev.map(m => m.id));
            const uniqueNewMessages = processedNewMessages.filter(msg => !existingIds.has(msg.id));
            
            if (uniqueNewMessages.length === 0) {
              return prev; // No new unique messages
            }
            
            // Combine and sort all messages
            const allMessages = [...prev, ...uniqueNewMessages].sort((a: Message, b: Message) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            
            // Deduplicate to ensure no duplicates (extra safety)
            const uniqueMessages = deduplicateMessages(allMessages);
            
            // Update latest message ID
            const latestMsg = uniqueMessages[uniqueMessages.length - 1];
            latestMessageIdRef.current = latestMsg.id;
            messagesLengthRef.current = uniqueMessages.length;
            
            return uniqueMessages; // Return deduplicated messages, not allMessages
          });
          
            // Auto-scroll to bottom when receiving new messages
            // Only scroll if user is near bottom (hasn't manually scrolled up)
            // Prevent during initial load - onLayout handles initial scroll
            if (shouldAutoScrollRef.current && !userScrolledRef.current && hasAttemptedInitialScrollRef.current) {
              // Small delay to let state update complete
              requestAnimationFrame(() => {
                setTimeout(() => {
                  scrollToBottom(false, 0, false); // animated = false, delay = 0, force = false
                }, 100);
              });
            }
        }
      }
    } catch (error: any) {
      // Silently handle errors - don't interrupt user
      // Only log in dev mode
      if (__DEV__) {
        console.log('[UserChat] Polling error (silent):', error.message);
      }
    } finally {
      isPollingRef.current = false;
    }
  }, [id, loadingMore, sending, messages, hasScrolledToBottom, scrollToBottom]);

  // Start/stop polling based on screen focus and user activity
  useEffect(() => {
    // Don't start polling if:
    // - User is loading more messages
    // - User is sending a message
    // - No messages loaded yet
    if (loadingMore || sending || messages.length === 0 || !latestMessageIdRef.current) {
      // Clear polling if it exists
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    // Start polling
    pollingIntervalRef.current = setInterval(() => {
      pollForNewMessages();
    }, POLLING_INTERVAL);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [id, loadingMore, sending, messages.length, pollForNewMessages]);
  
  // Start retry service on mount
  useEffect(() => {
    if (dbInitialized) {
      startRetryService(30000); // Retry every 30 seconds
    }
    
    return () => {
      // Cleanup handled by stopRetryService if needed
    };
  }, [dbInitialized]);
  
  // Initial fetch on mount
  useEffect(() => {
    // Reset retry state when conversation changes
    retryAttemptRef.current = 0;
    messagesLengthRef.current = 0; // Reset messages length ref
    isPaginatingRef.current = false; // Reset pagination flag
    lastFocusTimeRef.current = 0; // Reset focus time
    latestMessageIdRef.current = null; // Reset latest message ID
    isPollingRef.current = false; // Reset polling flag
    
    // Clear polling interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    
    // Clear retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    // Note: fetchMessages is handled by useFocusEffect to prevent duplicate fetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]); // Only depend on id, fetchMessages is stable
  
  // Cleanup retry timeout, polling, and scroll timeouts on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  // Improved scroll to bottom function that uses content size to scroll to absolute bottom
  const scrollToBottom = useCallback((animated = false, delay = 0, force = false) => {
    // Prevent scroll during initial load unless forced (onLayout handles initial scroll)
    if (!force && !hasAttemptedInitialScrollRef.current) {
      return;
    }
    
    // Check if we should auto-scroll (unless forced)
    if (!force && !shouldAutoScrollRef.current) {
      return;
    }
    
    if (!flatListRef.current || messages.length === 0) {
      return;
    }
    
    // Clear any pending scroll to prevent multiple rapid scrolls
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
    
    const performScroll = () => {
      if (!flatListRef.current || messages.length === 0) {
        return;
      }
      
      try {
        // If we have content size and viewport size, use scrollToOffset for precise positioning
        if (contentSizeRef.current && viewportSizeRef.current) {
          const contentHeight = contentSizeRef.current.height;
          const viewportHeight = viewportSizeRef.current.height;
          const targetOffset = Math.max(0, contentHeight - viewportHeight);
          
          (flatListRef.current as any).scrollToOffset({ 
            offset: targetOffset, 
            animated 
          });
          setHasScrolledToBottom(true);
        } else {
          // Fallback to scrollToEnd if sizes aren't available yet
          (flatListRef.current as any).scrollToEnd({ animated });
          setHasScrolledToBottom(true);
        }
        
        if (!force) {
          shouldAutoScrollRef.current = false; // Reset after successful scroll
        }
      } catch (error) {
        console.warn('Scroll failed:', error);
      }
    };
    
    if (delay > 0) {
      scrollTimeoutRef.current = setTimeout(performScroll, delay);
    } else {
      requestAnimationFrame(performScroll);
    }
  }, [messages.length]);

  // Scroll to bottom when messages are loaded or conversation changes
  useEffect(() => {
    // Reset scroll flags when conversation changes
    if (hasScrolledForThisConversation.current !== id) {
      hasScrolledForThisConversation.current = id as string;
      setHasScrolledToBottom(false);
      isInitialLoadRef.current = true;
      userScrolledRef.current = false;
      shouldAutoScrollRef.current = true;
      lastScrollOffsetRef.current = 0;
      hasAttemptedInitialScrollRef.current = false;
      contentSizeRef.current = null;
      viewportSizeRef.current = null;
    }
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
  
  // Scroll to bottom when messages are first loaded (after content is rendered)
  // This is handled by onContentSizeChange and onLayout to avoid blank screen

  // Mark messages as read and refresh messages when conversation is opened
  useFocusEffect(
    useCallback(() => {
      // Set this conversation as active to suppress notifications
      const conversationId = Number(id);
      if (conversationId) {
        setActiveConversation(conversationId);
      }

      const now = Date.now();
      const timeSinceLastFocus = now - lastFocusTimeRef.current;
      lastFocusTimeRef.current = now;

      // Don't refresh if:
      // 1. User is currently loading more messages (paginating)
      // 2. User just focused (within 2 seconds) - likely a false trigger
      // 3. We're on a page > 1 (user has paginated) - don't reset their pagination
      const shouldSkipRefresh = 
        loadingMore || 
        isPaginatingRef.current || 
        currentPage > 1 ||
        (timeSinceLastFocus < 2000 && messages.length > 0);

      if (shouldSkipRefresh) {
        // Still mark messages as read, but don't refresh
        if (ENABLE_MARK_AS_READ && id && user) {
          const markMessagesAsRead = async () => {
            // CRITICAL FIX: Check network connectivity before making API call
            try {
              const netInfo = await NetInfo.fetch();
              if (!netInfo.isConnected) {
                if (__DEV__) {
                  console.log('[UserChat] Skipping mark as read - no network connection');
                }
                needsMarkAsReadRef.current = true; // Set flag to retry when network comes back
                return;
              }
            } catch (netError) {
              // If NetInfo fails, assume offline to be safe
              if (__DEV__) {
                console.warn('[UserChat] Could not check network status:', netError);
              }
              needsMarkAsReadRef.current = true;
              return;
            }
            
            try {
              await messagesAPI.markMessagesAsRead(Number(id));
              updateUnreadCount(Number(id), 0);
              needsMarkAsReadRef.current = false; // Reset flag on success
            } catch (error: any) {
              // Handle network errors gracefully
              const isNetworkError = 
                error?.code === 'ERR_NETWORK' ||
                error?.message?.includes('Network Error') ||
                !error?.response;
              
              if (isNetworkError) {
                needsMarkAsReadRef.current = true; // Set flag to retry when network comes back
                if (__DEV__) {
                  console.log('[UserChat] Mark as read failed - network error, will retry when online');
                }
              } else {
                // Other errors - silently ignore
                if (__DEV__) {
                  console.error('[UserChat] Error marking messages as read:', error);
                }
              }
            }
          };
          markMessagesAsRead();
        }
        return;
      }

      // Refresh messages when screen gains focus to get any new messages
      // Don't show loading spinner if messages already exist (to avoid flickering)
      const hasExistingMessages = messages.length > 0;
      
      // CRITICAL FIX: Don't reset scroll flags if user is viewing old messages
      // Only reset if we're at the bottom or it's a fresh conversation
      const shouldResetScroll = !loadingMore && !isPaginatingRef.current && currentPage === 1;
      
      if (shouldResetScroll) {
        // Reset scroll flag so we scroll to bottom after refresh
        setHasScrolledToBottom(false);
        // Enable auto-scroll when conversation is focused
        // Scroll will be handled by onContentSizeChange and onLayout
        shouldAutoScrollRef.current = true;
      } else {
        // User is viewing old messages, don't auto-scroll
        shouldAutoScrollRef.current = false;
      }
      
      fetchMessages(!hasExistingMessages);

      const markMessagesAsRead = async () => {
        if (!ENABLE_MARK_AS_READ || !id || !user) return;
        
        // CRITICAL FIX: Check network connectivity before making API call
        try {
          const netInfo = await NetInfo.fetch();
          if (!netInfo.isConnected) {
            if (__DEV__) {
              console.log('[UserChat] Skipping mark as read - no network connection');
            }
            needsMarkAsReadRef.current = true; // Set flag to retry when network comes back
            return; // Don't make API call if offline
          }
        } catch (netError) {
          // If NetInfo fails, assume offline to be safe
          if (__DEV__) {
            console.warn('[UserChat] Could not check network status:', netError);
          }
          needsMarkAsReadRef.current = true; // Set flag to retry when network comes back
          return;
        }
        
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
          needsMarkAsReadRef.current = false; // Reset flag on success
          
          if (__DEV__) {
            console.log('Messages marked as read for conversation:', id);
          }
        } catch (error: any) {
          // Handle network errors gracefully
          const isNetworkError = 
            error?.code === 'ERR_NETWORK' ||
            error?.message?.includes('Network Error') ||
            !error?.response;
          
          if (isNetworkError) {
            // Network error - set flag to retry when network comes back
            needsMarkAsReadRef.current = true;
            if (__DEV__) {
              console.log('[UserChat] Mark as read failed - network error, will retry when online');
            }
          } else {
            // Other errors (auth, validation, etc.) - log for debugging
            if (__DEV__) {
              console.error('[UserChat] Error marking messages as read:', error);
            }
          }
        }
      };

      // Small delay to ensure screen is fully loaded
      const timer = setTimeout(() => {
        markMessagesAsRead();
      }, 300);

      return () => {
        clearTimeout(timer);
        // Clear active conversation when screen loses focus
        clearActiveConversation();
      };
    }, [id, user, ENABLE_MARK_AS_READ, updateUnreadCount, setActiveConversation, clearActiveConversation, fetchMessages, messages.length, scrollToBottom, loadingMore, currentPage])
  );

  // CRITICAL FIX: Network listener to retry mark-read when network comes back
  useEffect(() => {
    if (!ENABLE_MARK_AS_READ || !id || !user) return;
    
    // Set up network listener
    const unsubscribe = NetInfo.addEventListener(state => {
      const isConnected = state.isConnected ?? false;
      
      if (isConnected && needsMarkAsReadRef.current) {
        // Network came back and we need to retry mark-read
        const retryMarkAsRead = async () => {
          try {
            await messagesAPI.markMessagesAsRead(Number(id));
            
            // Update local messages state
            setMessages(prevMessages => {
              const now = new Date().toISOString();
              return prevMessages.map(msg => {
                if (msg.sender_id === Number(id) && msg.receiver_id === user.id && !msg.read_at) {
                  return { ...msg, read_at: now };
                }
                return msg;
              });
            });
            
            updateUnreadCount(Number(id), 0);
            needsMarkAsReadRef.current = false; // Reset flag
            
            if (__DEV__) {
              console.log('[UserChat] Mark as read retried successfully after network reconnect');
            }
          } catch (error: any) {
            // If it still fails, check if it's a network error
            const isNetworkError = 
              error?.code === 'ERR_NETWORK' ||
              error?.message?.includes('Network Error') ||
              !error?.response;
            
            if (!isNetworkError) {
              // Non-network error - reset flag to avoid infinite retries
              needsMarkAsReadRef.current = false;
            }
            
            if (__DEV__) {
              console.error('[UserChat] Mark as read retry failed:', error);
            }
          }
        };
        
        // Small delay to ensure network is stable
        setTimeout(retryMarkAsRead, 500);
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, [id, user, ENABLE_MARK_AS_READ, updateUnreadCount]);

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

  // Load more messages function (incremental pagination)
  const loadMoreMessages = async () => {
    if (loadingMore || !hasMoreMessages) return;
    
    // CRITICAL FIX: Disable auto-scroll when loading older messages
    // User wants to stay at the top viewing old messages
    shouldAutoScrollRef.current = false;
    userScrolledRef.current = true; // Mark as user-initiated (viewing old messages)
    isPaginatingRef.current = true;
    setLoadingMore(true);
    
    try {
      // API-FIRST: Fetch older messages from API (comprehensive data)
      const nextPage = currentPage + 1;
      const res = await messagesAPI.getByUser(Number(id), nextPage, MESSAGES_PER_PAGE);
      
      const apiMessages = res.data.messages?.data || res.data.messages || [];
      const pagination = res.data.messages || {};
      
      if (apiMessages.length === 0) {
        setHasMoreMessages(false);
        return;
      }
      
      // Process messages
      const processedMessages = apiMessages.map((msg: any) => ({
        id: msg.id,
        message: msg.message || '',
        sender_id: msg.sender_id,
        receiver_id: msg.receiver_id,
        created_at: msg.created_at,
        read_at: msg.read_at,
        edited_at: msg.edited_at,
        attachments: msg.attachments,
        reply_to: msg.reply_to,
        sync_status: 'synced' as const,
      }));
      
      // Prepend older messages to existing messages
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const uniqueNewMessages = processedMessages.filter((msg: any) => !existingIds.has(msg.id));
        
        if (uniqueNewMessages.length === 0) {
          return prev;
        }
        
        // Combine and sort
        const allMessages = [...prev, ...uniqueNewMessages];
        return deduplicateMessages(allMessages.sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ));
      });
      
      setCurrentPage(nextPage);
      const hasMore = pagination.current_page < pagination.last_page || 
                     (apiMessages.length >= MESSAGES_PER_PAGE);
      setHasMoreMessages(hasMore);
      
      // BACKGROUND SYNC: Save to SQLite for offline access
      if (dbInitialized) {
        try {
          await syncOlderMessages(Number(id), 'individual', nextPage, MESSAGES_PER_PAGE);
        } catch (syncError) {
          // Silently fail - SQLite sync is not critical
          if (__DEV__) {
            console.warn('[UserChat] Error syncing older messages to SQLite:', syncError);
          }
        }
      }
      
    } catch (error) {
      console.error('[UserChat] Error loading more messages:', error);
      
      // FALLBACK: Try SQLite cache if API fails
      if (dbInitialized) {
        try {
          const currentOffset = loadedMessagesCount;
          const cachedMessages = await loadMessagesFromDb(MESSAGES_PER_PAGE, currentOffset);
          
          if (cachedMessages.length > 0) {
            setMessages(prev => {
              const existingIds = new Set(prev.map(m => m.id));
              const uniqueNew = cachedMessages.filter(msg => !existingIds.has(msg.id));
              return deduplicateMessages([...prev, ...uniqueNew].sort((a, b) => 
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              ));
            });
            setLoadedMessagesCount(prev => prev + cachedMessages.length);
            
            if (cachedMessages.length < MESSAGES_PER_PAGE) {
              setHasMoreMessages(false);
            }
          } else {
            setHasMoreMessages(false);
          }
        } catch (cacheError) {
          console.error('[UserChat] Error loading from cache:', cacheError);
          setHasMoreMessages(false);
        }
      } else {
        setHasMoreMessages(false);
      }
    } finally {
      setLoadingMore(false);
      setTimeout(() => {
        isPaginatingRef.current = false;
      }, 1000);
    }
  };

  // Send message
  const handleSend = async () => {
    // Don't send if there's no content at all
    if (!input.trim() && !attachment && !voiceRecording) return;
    
    // Prevent multiple simultaneous sends
    if (sending) {
      console.warn('Message send already in progress, ignoring duplicate send');
      return;
    }
    
    setSending(true);
    
    // Prepare message text
    let messageText = input.trim();
    if (attachment && !messageText) {
      if (attachment.type?.startsWith('image/') || attachment.isImage) {
        messageText = '[IMAGE]';
      } else {
        messageText = '[FILE]';
      }
    }
    
    if (voiceRecording) {
      const voiceMessage = `[VOICE_MESSAGE:${voiceRecording.duration}]`;
      messageText = messageText ? `${messageText} ${voiceMessage}` : voiceMessage;
    }
    
    // Generate temporary local ID for the message
    const tempLocalId = Date.now() + Math.random();
    const now = new Date().toISOString();
    
    // Create message object for local storage
    const localMessage = {
      id: tempLocalId, // Temporary local ID
      conversation_id: Number(id),
      conversation_type: 'individual' as const,
      sender_id: Number(user?.id || 0),
      receiver_id: Number(id),
      message: messageText || null,
      created_at: now,
      read_at: null,
      edited_at: null,
      reply_to_id: replyingTo?.id || null,
      sync_status: 'pending' as const,
      attachments: attachment ? [{
        name: attachment.name || 'attachment',
        mime: attachment.type || 'application/octet-stream',
        url: attachment.uri, // Local URI for now
        local_path: attachment.uri,
      }] : voiceRecording ? [{
        name: 'voice_message.m4a',
        mime: 'audio/m4a',
        url: voiceRecording.uri,
        local_path: voiceRecording.uri,
      }] : undefined,
    };
    
    // Create message for UI display
    const uiMessage: any = {
      id: tempLocalId,
      conversation_id: Number(id),
      sender_id: Number(user?.id || 0),
      receiver_id: Number(id),
      message: messageText || null,
      created_at: now,
      read_at: null,
      edited_at: null,
      reply_to_id: replyingTo?.id || null,
      reply_to: replyingTo || undefined,
      sender: {
        id: Number(user?.id || 0),
        name: user?.name || 'You',
        avatar_url: user?.avatar_url,
      },
      sync_status: 'pending' as const, // Start as pending (single gray tick)
      attachments: localMessage.attachments,
    };
    
    try {
      // STEP 1: Save to SQLite first with pending status (instant local storage)
      if (dbInitialized) {
        try {
          await saveDbMessages([{
            id: tempLocalId,
            conversation_id: Number(id),
            conversation_type: 'individual',
            sender_id: Number(user?.id || 0),
            receiver_id: Number(id),
            message: messageText || null,
            created_at: now,
            read_at: null,
            edited_at: null,
            reply_to_id: replyingTo?.id || null,
            sync_status: 'pending',
            attachments: localMessage.attachments,
          }]);
          
          if (__DEV__) {
            console.log('[UserChat] Saved message to SQLite with pending status:', tempLocalId);
          }
        } catch (dbError) {
          console.error('[UserChat] Error saving to SQLite:', dbError);
          // Continue anyway - we'll still try to send to API
        }
      }
      
      // STEP 2: Show message immediately in UI (optimistic update)
      setMessages(prev => {
        // Check if message with this tempLocalId already exists (prevent duplicates)
        const existingIds = new Set(prev.map(m => m.id));
        if (existingIds.has(tempLocalId)) {
          if (__DEV__) {
            console.warn('[UserChat] Message with tempLocalId already exists, skipping:', tempLocalId);
          }
          return prev; // Don't add duplicate
        }
        
        const updatedMessages = [...prev, uiMessage].sort((a, b) => {
          const dateA = new Date(a.created_at).getTime();
          const dateB = new Date(b.created_at).getTime();
          return dateA - dateB;
        });
        
        const uniqueMessages = deduplicateMessages(updatedMessages);
        
        if (uniqueMessages.length > 0) {
          const latestMsg = uniqueMessages[uniqueMessages.length - 1];
          latestMessageIdRef.current = latestMsg.id;
        }
        
        // Scroll to bottom
        shouldAutoScrollRef.current = true;
        userScrolledRef.current = false;
        requestAnimationFrame(() => {
          setTimeout(() => {
            scrollToBottom(true, 0, true);
          }, attachment || voiceRecording ? 200 : 50);
        });
        
        return uniqueMessages;
      });
      
      // Clear input immediately for better UX
      setInput('');
      setAttachment(null);
      setVoiceRecording(null);
      setReplyingTo(null);
      setShowEmoji(false);
      setSending(false); // Reset sending state - API call happens in background
      
      // CRITICAL FIX: Dismiss keyboard after sending to prevent extra space
      Keyboard.dismiss();
      
      // STEP 3: Send to API in background (non-blocking)
      (async () => {
        try {
          // Check if message already has server_id (already synced) before sending
          // This prevents duplicate sends if retry service already sent it
          if (dbInitialized) {
            try {
              const database = await getDb();
              if (database) {
                const existingMessage = await database.getFirstAsync<{ server_id?: number; created_at?: string }>(
                  `SELECT server_id, created_at FROM messages WHERE id = ?`,
                  [tempLocalId]
                );
                
                if (existingMessage?.server_id) {
                  if (__DEV__) {
                    console.log(`[UserChat] Message ${tempLocalId} already has server_id ${existingMessage.server_id}, skipping API call`);
                  }
                  // Update UI with server ID and server timestamp
                  setMessages(prev => prev.map(msg => 
                    msg.id === tempLocalId 
                      ? { 
                          ...msg, 
                          id: existingMessage.server_id!, 
                          sync_status: 'synced',
                          created_at: existingMessage.created_at || msg.created_at // Use server timestamp from DB
                        }
                      : msg
                  ));
                  return; // Don't send again
                }
              }
            } catch (checkError) {
              // Continue with send if check fails
              if (__DEV__) {
                console.warn('[UserChat] Error checking message status:', checkError);
              }
            }
          }
          
          let formData = new FormData();
          formData.append('receiver_id', String(id));
          
          if (replyingTo) {
            formData.append('reply_to_id', replyingTo.id.toString());
          }
          
          if (attachment) {
            formData.append('attachments[]', {
              uri: attachment.uri,
              name: attachment.name,
              type: attachment.type,
            } as any);
          }
          
          if (messageText && !voiceRecording) {
            formData.append('message', messageText);
          }
          
          if (voiceRecording) {
            formData.append('message', messageText);
            formData.append('attachments[]', {
              uri: voiceRecording.uri,
              name: 'voice_message.m4a',
              type: 'audio/m4a',
            } as any);
            formData.append('voice_duration', voiceRecording.duration.toString());
            formData.append('is_voice_message', 'true');
          }
          
          // Send to API
          const res = await messagesAPI.sendMessage(formData);
          
          // CRITICAL: Log response structure for debugging in production
          if (__DEV__ || process.env.EXPO_PUBLIC_DEBUG_API === 'true') {
            console.log('[UserChat] API Response:', {
              status: res.status,
              hasData: !!res.data,
              dataKeys: res.data ? Object.keys(res.data) : [],
              dataId: res.data?.id,
              dataCreatedAt: res.data?.created_at,
              fullResponse: JSON.stringify(res.data, null, 2).substring(0, 500),
            });
          }
          
          // STEP 4: Update SQLite with server response (change status to synced, update server_id and timestamp)
          // Handle different response structures
          let messageId: number | undefined;
          let serverCreatedAt: string | undefined;
          
          if (res.data) {
            // Standard structure: res.data.id
            if (res.data.id) {
              messageId = res.data.id;
              serverCreatedAt = res.data.created_at;
            }
            // Alternative: res.data.data.id (nested)
            else if (res.data.data && res.data.data.id) {
              messageId = res.data.data.id;
              serverCreatedAt = res.data.data.created_at;
            }
            // Alternative: res.data.message?.id
            else if (res.data.message && res.data.message.id) {
              messageId = res.data.message.id;
              serverCreatedAt = res.data.message.created_at;
            }
          }
          
          if (messageId && dbInitialized) {
            try {
              // Update with server timestamp to prevent duplicates with different timestamps
              await updateMessageStatus(tempLocalId, messageId, 'synced', serverCreatedAt);
              
              // Update UI message with server ID and server timestamp, checking for duplicates
              setMessages(prev => {
                // Check if message with server ID already exists (from a sync)
                const existingIds = new Set(prev.map(m => m.id));
                const serverIdExists = existingIds.has(messageId);
                
                if (serverIdExists) {
                  // Server ID already exists, remove the tempLocalId message to avoid duplication
                  if (__DEV__) {
                    console.log('[UserChat] Server ID already exists, removing tempLocalId message:', tempLocalId);
                  }
                  const filtered = prev.filter(msg => msg.id !== tempLocalId);
                  // Ensure deduplication after filtering
                  return deduplicateMessages(filtered);
                } else {
                  // Update the tempLocalId to server ID AND update timestamp to match server
                  const updated = prev.map(msg => 
                    msg.id === tempLocalId 
                      ? { 
                          ...msg, 
                          id: messageId, 
                          sync_status: 'synced',
                          created_at: serverCreatedAt || msg.created_at // Use server timestamp
                        }
                      : msg
                  );
                  // Ensure deduplication after update
                  return deduplicateMessages(updated);
                }
              });
              
              // Update latest message ID
              latestMessageIdRef.current = messageId;
              
              if (__DEV__ || process.env.EXPO_PUBLIC_DEBUG_API === 'true') {
                console.log('[UserChat] Message synced successfully:', tempLocalId, '->', messageId, 'with timestamp:', serverCreatedAt);
              }
            } catch (updateError) {
              console.error('[UserChat] Error updating message status:', updateError);
            }
          }
          
          // Update last_seen_at
          try {
            await usersAPI.updateLastSeen();
          } catch (error) {
            // Silently fail
          }
          
        } catch (apiError: any) {
          // STEP 5: Handle API failure gracefully
          // CRITICAL: Always log errors in production for debugging
          console.error('[UserChat] Error sending message to API:', {
            message: apiError.message,
            status: apiError.response?.status,
            statusText: apiError.response?.statusText,
            data: apiError.response?.data,
            code: apiError.code,
            url: apiError.config?.url,
            baseURL: apiError.config?.baseURL,
            method: apiError.config?.method,
            tempLocalId: tempLocalId,
          });
          
          // Check if it's a network error (retryable) or permanent error
          const isNetworkError = 
            apiError.message === 'Network Error' || 
            !apiError.response ||
            apiError.code === 'ECONNABORTED' ||
            apiError.message?.includes('timeout');
          
          if (dbInitialized) {
            if (!isNetworkError && apiError.response?.status >= 400 && apiError.response?.status < 500) {
              // Client error (4xx) - mark as failed
              await updateMessageStatus(tempLocalId, undefined, 'failed');
              
              // Update UI to show failed status
              setMessages(prev => prev.map(msg => 
                msg.id === tempLocalId 
                  ? { ...msg, sync_status: 'failed' }
                  : msg
              ));
              
              if (__DEV__) {
                console.log('[UserChat] Message marked as failed:', tempLocalId);
              }
            } else {
              // Network/server error - keep as pending for retry
              // Retry service will handle it
              if (__DEV__) {
                console.log('[UserChat] Message kept as pending for retry:', tempLocalId);
              }
            }
          }
          
          // Silently retry immediately - no popup, process in background
          // Trigger immediate retry for network/server errors
          if (isNetworkError || (apiError.response?.status >= 500)) {
            // Network/server error - trigger immediate retry after short delay
            setTimeout(() => {
              retryPendingMessages().catch(err => {
                if (__DEV__) {
                  console.error('[UserChat] Immediate retry failed:', err);
                }
              });
            }, 2000); // Retry after 2 seconds
          }
          // For 4xx errors, keep as pending/failed - retry service will handle it
          // No popup - process silently in background
        }
      })();
      
    } catch (e: unknown) {
      const error = e as any;
      console.error('[UserChat] Error in handleSend:', error);
      setSending(false);
      
      Alert.alert(
        'Error',
        'Failed to save message. Please try again.',
        [{ text: 'OK' }]
      );
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

  // Handle file download
  const handleFileDownload = async (attachment: any) => {
    try {
      const fileUrl = attachment.url || attachment.path || attachment.uri;
      let downloadUrl = fileUrl;
      
      if (fileUrl && !fileUrl.startsWith('http')) {
        const cleanUrl = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
        downloadUrl = `${getBaseUrl()}/${cleanUrl}`;
      }
      
      if (!downloadUrl) {
        Alert.alert('Error', 'File URL not available');
        return;
      }

      const fileName = attachment.name || 'download';
      
      // Show loading alert
      Alert.alert('Downloading', `Downloading ${fileName}...`, [], { cancelable: true });
      
      // Create a local file path with unique name to avoid conflicts
      // Sanitize filename and encode URL properly for iOS compatibility
      const timestamp = Date.now();
      const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
      const fileUri = `${FileSystem.documentDirectory}${timestamp}_${sanitizedFileName}`;
      
      // Ensure download URL is properly encoded
      const encodedDownloadUrl = encodeURI(downloadUrl);
      
      // Download the file using legacy API
      const downloadResult = await FileSystem.downloadAsync(encodedDownloadUrl, fileUri);
      
      // Dismiss loading alert by showing result
      if (downloadResult.status === 200) {
        // Check if sharing is available
        const isAvailable = await Sharing.isAvailableAsync();
        
        if (isAvailable) {
          // Share/open the file (allows user to save, open with other apps, etc.)
          await Sharing.shareAsync(downloadResult.uri, {
            mimeType: attachment.mime || 'application/octet-stream',
            dialogTitle: `Save ${fileName}`,
            UTI: attachment.mime || 'public.data',
          });
        } else {
          // Fallback: Show success message with file location
          Alert.alert(
            'Download Complete',
            `File saved: ${fileName}\n\nYou can find it in your device's file manager.`,
            [{ text: 'OK' }]
          );
        }
      } else {
        throw new Error(`Download failed with status ${downloadResult.status}`);
      }
    } catch (error: any) {
      console.error('File download error:', error);
      
      // Check for specific error types
      let errorMessage = 'Failed to download file. Please check your internet connection and try again.';
      
      if (error?.message?.includes('Network')) {
        errorMessage = 'Network error. Please check your internet connection.';
      } else if (error?.message?.includes('404')) {
        errorMessage = 'File not found on server.';
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      Alert.alert('Download Failed', errorMessage, [{ text: 'OK' }]);
    }
  };

  // Check if message can be edited (within 15 minutes)
  const canEditMessage = (message: Message): boolean => {
    if (!message.created_at) return false;
    const messageDate = new Date(message.created_at);
    const now = new Date();
    const diffInMinutes = (now.getTime() - messageDate.getTime()) / (1000 * 60);
    return diffInMinutes <= 15; // 15 minute limit
  };

  // Handle edit message
  const handleEditMessage = (message: Message) => {
    if (!canEditMessage(message)) {
      Alert.alert(
        'Cannot Edit',
        'You can only edit messages within 15 minutes of sending them.',
        [{ text: 'OK' }]
      );
      setShowMessageOptions(null);
      return;
    }
    
    setEditingMessage(message);
    setEditText(message.message || '');
    setShowMessageOptions(null);
  };

  // Handle save edited message
  const handleSaveEdit = async () => {
    if (!editingMessage || !editText.trim()) {
      setEditingMessage(null);
      setEditText('');
      return;
    }

    try {
      const response = await messagesAPI.editMessage(editingMessage.id, editText.trim());
      
      const editedAt = response.data.edited_at || new Date().toISOString();
      
      // Update message in local state
      setMessages(prev => prev.map(msg => 
        msg.id === editingMessage.id 
          ? { ...msg, message: editText.trim(), edited_at: editedAt }
          : msg
      ));
      
      // Update SQLite immediately
      if (dbInitialized) {
        try {
          await updateMessageByServerId(editingMessage.id, {
            message: editText.trim(),
            edited_at: editedAt,
          });
          if (__DEV__) {
            console.log('[UserChat] Updated edited message in SQLite:', editingMessage.id);
          }
        } catch (dbError) {
          console.error('[UserChat] Error updating SQLite after edit:', dbError);
          // Continue anyway - sync will fix it later
        }
      }
      
      setEditingMessage(null);
      setEditText('');
    } catch (error: any) {
      console.error('Error editing message:', error);
      
      if (error?.response?.status === 403) {
        Alert.alert('Permission Denied', 'You can only edit your own messages.');
      } else if (error?.response?.status === 400) {
        Alert.alert('Cannot Edit', error?.response?.data?.message || 'This message can no longer be edited.');
      } else {
        Alert.alert('Error', 'Failed to edit message. Please try again.');
      }
      
      setEditingMessage(null);
      setEditText('');
    }
  };

  // Handle cancel edit
  const handleCancelEdit = () => {
    setEditingMessage(null);
    setEditText('');
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
              
              // Delete from SQLite immediately
              if (dbInitialized) {
                try {
                  await deleteDbMessage(messageId);
                  if (__DEV__) {
                    console.log('[UserChat] Deleted message from SQLite:', messageId);
                  }
                } catch (dbError) {
                  console.error('[UserChat] Error deleting from SQLite:', dbError);
                  // Continue anyway - sync will fix it later
                }
              }
              
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
                  [{ text: 'OK', onPress: async () => {
                    // Remove from local state anyway
                    setMessages(prev => prev.filter(msg => msg.id !== messageId));
                    
                    // Also try to delete from SQLite
                    if (dbInitialized) {
                      try {
                        await deleteDbMessage(messageId);
                      } catch (dbError) {
                        console.error('[UserChat] Error deleting from SQLite (404 case):', dbError);
                      }
                    }
                    
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
  const renderItem = ({ item, index }: { item: Message; index: number }) => {
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
        audioAttachment = item.attachments.find((att: any) => att.mime?.startsWith('audio/'));
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
            syncStatus={item.sync_status || 'synced'}
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
                {/* Timestamp and read receipt below video */}
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
                  {isMine && (
                    <MessageStatus 
                      readAt={item.read_at} 
                      syncStatus={item.sync_status || 'synced'}
                      isDark={isDark}
                      size={12}
                    />
                  )}
                </View>
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
                        let url = firstAttachment.url || firstAttachment.path || firstAttachment.uri || '';
                        
                        if (url && !url.startsWith('http')) {
                          // Remove leading slash if present and construct full URL
                          const cleanUrl = url.startsWith('/') ? url.substring(1) : url;
                          const fullUrl = `${getBaseUrl()}/${cleanUrl}`;
                          return fullUrl;
                        }
                        return url || '';
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
                      syncStatus={item.sync_status || 'synced'}
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
                    onPress={() => handleFileDownload(firstAttachment)}
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
                      syncStatus={item.sync_status || 'synced'}
                      isDark={isDark}
                      size={12}
                    />
                  )}
                </View>
              </View>
            );
          })()}
          
          {/* Message content and timestamp in a flex container */}
          <View style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
            {/* Display message text - NEVER show [IMAGE] or [FILE] markers as text */}
            {!isVoiceMessage && (
              messageText && messageText.trim() ? (
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
                }}>
                  {timestamp}
                  {item.edited_at && ' • Edited'}
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
            
            {/* Show Edit option for your own messages (within time limit) */}
            {isMine && canEditMessage(item) && (
              <TouchableOpacity
                onPress={() => handleEditMessage(item)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                }}
              >
                <MaterialIcons name="edit" size={16} color={isDark ? '#fff' : '#000'} />
                <Text style={{ marginLeft: 8, color: isDark ? '#fff' : '#000', fontSize: 14 }}>Edit</Text>
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
  const handleEmojiSelect = (emoji: { native: string }) => {
    setInput(input + emoji.native);
    setShowEmoji(false);
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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} // ✅ Re-enable for Android with 'height' behavior
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        enabled={true} // ✅ Enable for both platforms
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
              extraData={messages.length} // Force re-render when messages array changes
              initialNumToRender={30} // Render 30 items initially for better performance
              windowSize={10} // Keep 10 screens worth of items in memory (optimized)
              maxToRenderPerBatch={15} // Render 15 items per batch
              removeClippedSubviews={true} // Remove off-screen views for better performance
              updateCellsBatchingPeriod={50} // Batch updates every 50ms
              // REMOVED: onEndReached - it fires at bottom (newest messages) but we want to load at top (oldest)
              // Loading more messages is handled by onScroll handler when user scrolls to top
              keyExtractor={(item, index) => {
                // Use message ID if available, otherwise use index with a stable fallback
                // Always include index as a fallback to ensure uniqueness even with duplicate IDs
                if (item && item.id !== undefined && item.id !== null && item.id !== 0) {
                  // Include index and created_at to ensure uniqueness even if duplicate IDs exist
                  // This prevents React key warnings when deduplication hasn't run yet
                  const createdAt = item.created_at ? `-${item.created_at}` : '';
                  return `message-${item.id}${createdAt}-${index}`;
                }
                // For messages without IDs, use index and created_at if available
                // Include sender_id to make it more unique
                const fallbackKey = item?.created_at
                  ? `message-fallback-${index}-${item.sender_id || 'unknown'}-${item.created_at}`
                  : `message-fallback-${index}-${item.sender_id || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                return fallbackKey;
              }}
              style={{ flex: 1 }}
              contentContainerStyle={{ 
                padding: 16, 
                paddingBottom: 0, // Let KeyboardAvoidingView handle spacing
              }}
              inverted={false} // Make sure it's not inverted
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              onScrollToIndexFailed={(info) => {
                // Handle scrollToIndex failures (e.g., item not rendered yet)
                // Prevent during initial load - onLayout handles initial scroll
                if (!hasAttemptedInitialScrollRef.current) {
                  return;
                }
                // Fallback to scrollToEnd only after initial scroll is done
                const wait = new Promise(resolve => setTimeout(resolve, 500));
                wait.then(() => {
                  if (flatListRef.current && messages.length > 0 && hasAttemptedInitialScrollRef.current) {
                    try {
                      (flatListRef.current as any).scrollToEnd({ animated: false });
                      setHasScrolledToBottom(true);
                    } catch (error) {
                      console.warn('Fallback scrollToEnd also failed:', error);
                    }
                  }
                });
              }}
              onScroll={({ nativeEvent }) => {
                const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
                
                // Track content and viewport sizes for precise scrolling
                contentSizeRef.current = { width: contentSize.width, height: contentSize.height };
                viewportSizeRef.current = { width: layoutMeasurement.width, height: layoutMeasurement.height };
                
                // Detect user-initiated scrolling
                const currentOffset = contentOffset.y;
                const previousOffset = lastScrollOffsetRef.current;
                
                // Calculate if user is near bottom (within 100px threshold)
                const contentHeight = contentSize.height;
                const viewportHeight = layoutMeasurement.height;
                const distanceFromBottom = contentHeight - (currentOffset + viewportHeight);
                const isNearBottom = distanceFromBottom <= 100;
                
                // Detect if this is a user-initiated scroll (not programmatic)
                // If offset changed significantly and we're not near bottom, user scrolled
                if (previousOffset !== 0 && Math.abs(currentOffset - previousOffset) > 10) {
                  if (!isNearBottom) {
                    // User scrolled away from bottom (viewing old messages)
                    userScrolledRef.current = true;
                    shouldAutoScrollRef.current = false;
                  } else {
                    // User scrolled back to bottom - only enable auto-scroll if not loading more
                    if (!loadingMore && !isPaginatingRef.current) {
                      userScrolledRef.current = false;
                      shouldAutoScrollRef.current = true;
                    }
                  }
                }
                
                lastScrollOffsetRef.current = currentOffset;
                
                // Load more messages when at top (existing functionality)
                const isAtTop = contentOffset.y <= 50; // Within 50 pixels of the top
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
                // Track content size for precise scrolling
                const previousContentHeight = contentSizeRef.current?.height || 0;
                contentSizeRef.current = { width: contentWidth, height: contentHeight };
                
                // CRITICAL FIX: Don't scroll if:
                // 1. Loading more messages (pagination) - user is viewing old messages at top
                // 2. User has scrolled away from bottom
                // 3. Still in initial load period
                // 4. Content size decreased or didn't increase significantly (images unloading, not new content)
                const contentIncreased = contentHeight > previousContentHeight + 10; // At least 10px increase
                
                if (loadingMore || 
                    loading || 
                    userScrolledRef.current || 
                    isInitialLoadRef.current || 
                    !hasAttemptedInitialScrollRef.current ||
                    !contentIncreased ||
                    isPaginatingRef.current) {
                  // Don't scroll - user is viewing old messages or content is shrinking
                  return;
                }
                
                // Only scroll if we're near bottom and content increased (new messages at bottom)
                if (shouldAutoScrollRef.current && messages.length > 0) {
                  // Check if we're near bottom before scrolling
                  if (viewportSizeRef.current && lastScrollOffsetRef.current > 0) {
                    const currentOffset = lastScrollOffsetRef.current;
                    const viewportHeight = viewportSizeRef.current.height;
                    const distanceFromBottom = contentHeight - (currentOffset + viewportHeight);
                    const isNearBottom = distanceFromBottom < 200; // Within 200px of bottom
                    
                    if (!isNearBottom) {
                      // User is not near bottom, don't auto-scroll
                      return;
                    }
                  }
                  
                  // Clear any pending scroll
                  if (scrollTimeoutRef.current) {
                    clearTimeout(scrollTimeoutRef.current);
                  }
                  
                  // Wait for viewport size to be available, then scroll to absolute bottom
                  scrollTimeoutRef.current = setTimeout(() => {
                    if (flatListRef.current && messages.length > 0 && shouldAutoScrollRef.current && !userScrolledRef.current && !loadingMore && !isPaginatingRef.current) {
                      try {
                        // Use scrollToOffset for precise positioning if we have viewport size
                        if (viewportSizeRef.current && contentSizeRef.current) {
                          const targetOffset = Math.max(0, contentSizeRef.current.height - viewportSizeRef.current.height);
                          (flatListRef.current as any).scrollToOffset({
                            offset: targetOffset,
                            animated: false
                          });
                        } else {
                          // Fallback to scrollToEnd
                          (flatListRef.current as any).scrollToEnd({ animated: false });
                        }
                        setHasScrolledToBottom(true);
                        // Note: Don't set hasAttemptedInitialScrollRef here - onLayout handles initial scroll
                      } catch (error) {
                        console.warn('Scroll failed:', error);
                      }
                    }
                  }, 150);
                }
              }}
              onLayout={(event) => {
                // Track viewport size when layout is ready
                const { width, height } = event.nativeEvent.layout;
                viewportSizeRef.current = { width, height };
                
                // Scroll to bottom when layout is ready (only on initial load, once)
                if (!loading && messages.length > 0 && isInitialLoadRef.current && shouldAutoScrollRef.current && !hasAttemptedInitialScrollRef.current) {
                  // Set flag immediately to block onContentSizeChange from scrolling during initial load
                  hasAttemptedInitialScrollRef.current = true;
                  
                  // Clear any pending scroll
                  if (scrollTimeoutRef.current) {
                    clearTimeout(scrollTimeoutRef.current);
                  }
                  
                  // Wait for content to be measured, then scroll to absolute bottom
                  scrollTimeoutRef.current = setTimeout(() => {
                    if (flatListRef.current && messages.length > 0 && isInitialLoadRef.current) {
                      try {
                        // Use scrollToOffset for precise positioning if we have both sizes
                        if (viewportSizeRef.current && contentSizeRef.current) {
                          const targetOffset = Math.max(0, contentSizeRef.current.height - viewportSizeRef.current.height);
                          (flatListRef.current as any).scrollToOffset({ 
                            offset: targetOffset, 
                            animated: false 
                          });
                        } else {
                          // Fallback: try scrollToEnd, or scroll to last index
                          try {
                            (flatListRef.current as any).scrollToEnd({ animated: false });
                          } catch (e) {
                            // Last resort: scroll to last message index
                            const lastIndex = messages.length - 1;
                            if (lastIndex >= 0) {
                              (flatListRef.current as any).scrollToIndex({ 
                                index: lastIndex, 
                                animated: false,
                                viewPosition: 1
                              });
                            }
                          }
                        }
                        setHasScrolledToBottom(true);
                        isInitialLoadRef.current = false;
                        // Note: hasAttemptedInitialScrollRef was set earlier to block competing scrolls
                      } catch (error) {
                        console.warn('Initial scroll failed:', error);
                      }
                    }
                  }, 400);
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
        {/* Edit Message Preview */}
        {editingMessage && (
          <View style={{
            backgroundColor: isDark ? '#374151' : '#F3F4F6',
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: isDark ? '#4B5563' : '#D1D5DB',
            flexDirection: 'row',
            alignItems: 'center',
          }}>
            <MaterialIcons name="edit" size={20} color="#283891" />
            <Text style={{ 
              marginLeft: 8, 
              color: isDark ? '#fff' : '#111827',
              fontSize: 14,
              fontWeight: '500',
              flex: 1,
            }}>
              Editing message
            </Text>
            <TouchableOpacity onPress={handleCancelEdit}>
              <MaterialCommunityIcons name="close-circle" size={24} color="#6B7280" />
            </TouchableOpacity>
          </View>
        )}
        
        {/* Reply Preview */}
        {replyingTo && !editingMessage && (
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
              ? Math.max(insets.bottom, 8) // ✅ Always use safe area padding, let KeyboardAvoidingView handle keyboard
              : (keyboardHeight > 0 ? 8 : Math.max(insets.bottom, 16)), // ✅ iOS keeps keyboard-aware padding
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
            {/* Emoji Button - Hide when editing */}
            {!editingMessage && (
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
            )}

            {/* Text Input */}
            <TextInput
              value={editingMessage ? editText : input}
              onChangeText={editingMessage ? setEditText : setInput}
              placeholder={editingMessage ? "Edit message..." : "Message"}
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
              onSubmitEditing={editingMessage ? handleSaveEdit : handleSend}
              returnKeyType={editingMessage ? "done" : "send"}
              blurOnSubmit={false}
            />

            {/* Gallery Button (WhatsApp-style) - Hide when editing */}
            {!editingMessage && (
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
            )}

            {/* Attachment Button - Hide when editing */}
            {!editingMessage && (
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
            )}

            {/* Send/Mic/Edit Button */}
            {editingMessage ? (
              <TouchableOpacity 
                onPress={handleSaveEdit} 
                disabled={!editText.trim() || sending} 
                style={{ 
                  width: 42, 
                  height: 42, 
                  borderRadius: 21, 
                  backgroundColor: (!editText.trim() || sending) ? '#A5B4FC' : '#39B54A',
                  alignItems: 'center', 
                  justifyContent: 'center',
                }}
              >
                <MaterialIcons name="check" size={24} color="#fff" />
              </TouchableOpacity>
            ) : (!input.trim() && !attachment && !voiceRecording) ? (
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