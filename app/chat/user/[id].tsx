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
import { deleteMessage as deleteDbMessage, getDb, getMessages as getDbMessages, hasMessagesForConversation, initDatabase, saveMessages as saveDbMessages, updateMessageByServerId, updateMessageStatus } from '@/services/database';
import { startRetryService, retryPendingMessages, markMessageAsSending, unmarkMessageAsSending, isMessageBeingSent, getMessagesBeingSent } from '@/services/messageRetryService';
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const [visibleMessagesStartIndex, setVisibleMessagesStartIndex] = useState<number | null>(null); // Track which messages to display (null = show all, number = start index)
  
  // ✅ CRITICAL FIX: Define INITIAL_VISIBLE_MESSAGES before useMemo to prevent NaN
  const INITIAL_VISIBLE_MESSAGES = 30; // Show only last 30 messages initially (latest at bottom)
  
  // Compute visible messages - show only last N messages initially
  const visibleMessages = useMemo(() => {
    if (messages.length === 0) return [];
    if (visibleMessagesStartIndex === null) {
      // Initial load: show only last N messages (latest at bottom)
      const startIndex = Math.max(0, messages.length - INITIAL_VISIBLE_MESSAGES);
      const sliced = messages.slice(startIndex);
      
      // ✅ DEBUG LOGGING: Track visible messages computation
      console.log(`[UserChat] 📋 visibleMessages computed:`, {
        totalMessages: messages.length,
        visibleMessagesStartIndex: null,
        computedStartIndex: startIndex,
        visibleCount: sliced.length,
        firstVisibleMessage: sliced[0] ? {
          id: sliced[0].id,
          content: sliced[0].message?.substring(0, 30),
          created_at: sliced[0].created_at,
        } : null,
        lastVisibleMessage: sliced[sliced.length - 1] ? {
          id: sliced[sliced.length - 1].id,
          content: sliced[sliced.length - 1].message?.substring(0, 30),
          created_at: sliced[sliced.length - 1].created_at,
        } : null,
      });
      
      return sliced;
    }
    // Show messages from startIndex to end
    const sliced = messages.slice(visibleMessagesStartIndex);
    
    console.log(`[UserChat] 📋 visibleMessages computed (with startIndex):`, {
      totalMessages: messages.length,
      visibleMessagesStartIndex,
      visibleCount: sliced.length,
      firstVisibleMessage: sliced[0] ? {
        id: sliced[0].id,
        content: sliced[0].message?.substring(0, 30),
        created_at: sliced[0].created_at,
      } : null,
      lastVisibleMessage: sliced[sliced.length - 1] ? {
        id: sliced[sliced.length - 1].id,
        content: sliced[sliced.length - 1].message?.substring(0, 30),
        created_at: sliced[sliced.length - 1].created_at,
      } : null,
    });
    
    return sliced;
  }, [messages, visibleMessagesStartIndex]);
  
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
          // Same ID exists - check if they're truly identical (exact duplicate)
          const isIdentical = 
            (existingById.message || '') === (msg.message || '') &&
            existingById.sender_id === msg.sender_id &&
            existingById.created_at === msg.created_at;
          
          if (isIdentical) {
            // Truly identical - skip this duplicate
            continue;
          }
          
          // Same ID but different content - prefer the one with synced status or more complete data
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
  
  // Precise scroll position tracking
  const isInitialLoadRef = useRef<boolean>(true); // Track if this is the initial load
  const initialScrollCompleteRef = useRef<boolean>(false); // Track if initial scroll to bottom is complete
  const lastScrollOffsetRef = useRef<number>(0); // Track last scroll offset for pagination
  const isAtBottomRef = useRef<boolean>(true); // Track if user is at bottom
  const lastVisibleMessageIdRef = useRef<number | null>(null); // Track last visible message ID for anchor
  const needsMarkAsReadRef = useRef<boolean>(false); // Track if mark-read needs retry when network comes back
  
  // Precise position tracking refs
  const viewportHeightRef = useRef<number>(0); // Viewport/window height
  const lastMessageHeightRef = useRef<number>(0); // Last message bubble height
  const lastMessageYPositionRef = useRef<number>(0); // Last message's Y position from top of content
  const targetBottomOffsetRef = useRef<number>(20); // Desired distance from bottom (20px padding)
  const shouldMaintainPositionRef = useRef<boolean>(false); // Whether to maintain fixed position
  const messageHeightsRef = useRef<Map<number | string, number>>(new Map()); // Track heights of all messages
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastScrollTrigger, setLastScrollTrigger] = useState(0);
  const [dbInitialized, setDbInitialized] = useState(false);
  const [loadedMessagesCount, setLoadedMessagesCount] = useState(0);
  const MESSAGES_PER_PAGE = 50; // Load 50 messages at a time
  // Note: INITIAL_VISIBLE_MESSAGES moved above visibleMessages useMemo to prevent NaN

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
  // ✅ API-FIRST STRATEGY: Try API first, fallback to SQLite only if API fails
  const fetchMessages = useCallback(async (showLoading = true) => {
      // ✅ CRITICAL FIX: Capture isInitialLoad state at start of fetchMessages
      // This ensures we know if this is truly the initial load, even if flag changes during async operations
      const isActuallyInitialLoad = isInitialLoadRef.current;
      
      // Reset scroll flag on initial load
      if (isActuallyInitialLoad) {
        setHasScrolledToBottom(false);
        initialScrollCompleteRef.current = false; // ✅ Reset scroll complete flag to allow scrolling
      }
    
    // Show loading spinner if requested
    if (showLoading) {
      setLoading(true);
    }
    
    // STEP 1: Try API first (source of truth)
    let apiSuccess = false;
    let apiMessages: Message[] = [];
    let apiError: any = null;
    
    try {
      // Fetch more messages (50) to match syncConversationMessages and ensure all messages are loaded
      const res = await messagesAPI.getByUser(Number(id), 1, 50);
      
      // Handle Laravel pagination format
      const messagesData = res.data.messages?.data || res.data.messages || [];
      const pagination = res.data.messages || {};
      
      // Check if there are more messages using Laravel pagination
      const hasMore = pagination.current_page < pagination.last_page || 
                     pagination.current_page < pagination.lastPage ||
                     (pagination.current_page && pagination.last_page && pagination.current_page < pagination.last_page) ||
                     (messagesData.length >= 10);
      
      setHasMoreMessages(hasMore);
      
      // Process messages to ensure reply_to data is properly structured
      const processedMessages = messagesData.map((msg: any) => {
        if (msg.reply_to) {
          return msg;
        }
        
        if (msg.reply_to_id) {
          const repliedMessage = messagesData.find((m: any) => m.id === msg.reply_to_id);
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
      
      // Sort messages by created_at in ascending order (oldest first)
      const sortedMessages = processedMessages.sort((a: Message, b: Message) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      
      // Deduplicate messages
      const uniqueMessages = deduplicateMessages(sortedMessages);
      
      // Mark API as successful
      apiSuccess = true;
      apiMessages = uniqueMessages.map(msg => ({
        ...msg,
        sync_status: msg.sync_status || 'synced' as const,
      }));
      
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
          
          // ❌ REMOVED: fixDuplicateMessagesWithWrongTimestamps - not needed since:
          // 1. saveDbMessages already handles deduplication by server_id
          // 2. API is source of truth, data is already correct
          // 3. This function loads ALL messages which is slow
          // 4. It was blocking UI on every conversation open
        } catch (dbError) {
          console.error('[UserChat] Error saving messages to database:', dbError);
        }
      }
      
      // Set user info
      setUserInfo(res.data.selectedConversation);
      
      // Calculate online status
      if (res.data.selectedConversation) {
        const conversation = res.data.selectedConversation;
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
            const isUserOnline = !isNaN(lastSeenDate.getTime()) && diffInMinutes >= 0 && diffInMinutes <= 5;
            setIsOnline(isUserOnline);
          } catch (error) {
            console.error('Error calculating online status:', error);
            setIsOnline(false);
          }
        } else {
          setIsOnline(false);
        }
      }
      
      // Mark messages as read
      if (ENABLE_MARK_AS_READ) {
        try {
          await messagesAPI.markMessagesAsRead(Number(id));
          updateUnreadCount(Number(id), 0);
        } catch (error: any) {
          const statusCode = error?.response?.status;
          if (statusCode !== 429 && statusCode !== 422 && statusCode !== 404) {
            if (__DEV__) {
              console.log('markMessagesAsRead failed:', statusCode || error?.message || error);
            }
          }
        }
      }
      
      // Successfully fetched - reset retry attempts
      retryAttemptRef.current = 0;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    } catch (error: any) {
      apiError = error;
      console.error('[UserChat] API fetch failed:', error);
    }
    
    // STEP 2: Handle API result or fallback to SQLite
    // ✅ CRITICAL FIX: Use the captured isActuallyInitialLoad from the start of the function
    if (apiSuccess) {
      // ✅ API succeeded - use API data (even if empty, it's the truth)
      console.log(`[UserChat] 📥 fetchMessages API success:`, {
        messageCount: apiMessages.length,
        isInitialLoad: isActuallyInitialLoad,
        INITIAL_VISIBLE_MESSAGES,
      });
      
      setMessages(apiMessages);
      messagesLengthRef.current = apiMessages.length;
      
      if (apiMessages.length > 0) {
        const latestMsg = apiMessages[apiMessages.length - 1];
        latestMessageIdRef.current = latestMsg.id;
        console.log(`[UserChat] 📌 Latest message ID set to: ${latestMsg.id}`);
        
        // ✅ DEBUG LOGGING: Log initial message state
        console.log(`[UserChat] 📊 Initial message state after setMessages:`, {
          totalMessages: apiMessages.length,
          firstMessage: {
            id: apiMessages[0].id,
            content: apiMessages[0].message?.substring(0, 30),
            created_at: apiMessages[0].created_at,
          },
          lastMessage: {
            id: latestMsg.id,
            content: latestMsg.message?.substring(0, 30),
            created_at: latestMsg.created_at,
          },
          isInitialLoad: isInitialLoadRef.current,
          visibleMessagesStartIndex: visibleMessagesStartIndex,
          note: 'FlatList will render these messages. With inverted=false, latest messages appear at bottom (need to scroll to bottom).',
        });
      }
      
      // ✅ CRITICAL FIX: Use captured isActuallyInitialLoad
      // Initially show only last N messages (latest at bottom)
      if (isActuallyInitialLoad && apiMessages.length > INITIAL_VISIBLE_MESSAGES) {
        const startIndex = apiMessages.length - INITIAL_VISIBLE_MESSAGES;
        console.log(`[UserChat] 🎯 Setting visibleMessagesStartIndex:`, {
          totalMessages: apiMessages.length,
          INITIAL_VISIBLE_MESSAGES,
          startIndex,
          willShowMessagesFrom: startIndex,
          willShowMessagesTo: apiMessages.length - 1,
          firstMessageToShow: apiMessages[startIndex] ? {
            id: apiMessages[startIndex].id,
            content: apiMessages[startIndex].message?.substring(0, 30),
            created_at: apiMessages[startIndex].created_at,
          } : null,
          lastMessageToShow: apiMessages[apiMessages.length - 1] ? {
            id: apiMessages[apiMessages.length - 1].id,
            content: apiMessages[apiMessages.length - 1].message?.substring(0, 30),
            created_at: apiMessages[apiMessages.length - 1].created_at,
          } : null,
        });
        setVisibleMessagesStartIndex(startIndex);
      }
      // ✅ CRITICAL FIX: When messages < INITIAL_VISIBLE_MESSAGES, visibleMessagesStartIndex stays null
      // This is correct - visibleMessages useMemo will show all messages
      // But initialScrollIndex will still be set to ensure FlatList starts at the bottom
      
      setLoadedMessagesCount(apiMessages.length);
      
      if (showLoading) {
        setLoading(false);
      }
      
      // ✅ CRITICAL FIX: Use captured isActuallyInitialLoad
      if (isActuallyInitialLoad || isAtBottomRef.current) {
        setHasScrolledToBottom(false);
      }
    } else {
      // ❌ API failed - fallback to SQLite
      if (dbInitialized) {
        try {
          const sqliteMessages = await loadMessagesFromDb(MESSAGES_PER_PAGE, 0);
          
          if (sqliteMessages.length > 0) {
            // ✅ SQLite has data - use it
            const sortedMessages = sqliteMessages.sort((a, b) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            const uniqueMessages = deduplicateMessages(sortedMessages);
            setMessages(uniqueMessages);
            messagesLengthRef.current = uniqueMessages.length;
            setLoadedMessagesCount(uniqueMessages.length);
            
            if (uniqueMessages.length > 0) {
              const latestMsg = uniqueMessages[uniqueMessages.length - 1];
              latestMessageIdRef.current = latestMsg.id;
            }
            
            // ✅ CRITICAL FIX: Use captured isActuallyInitialLoad
            if (isActuallyInitialLoad && uniqueMessages.length > INITIAL_VISIBLE_MESSAGES) {
              const startIndex = uniqueMessages.length - INITIAL_VISIBLE_MESSAGES;
              console.log(`[UserChat] 🎯 Setting visibleMessagesStartIndex (SQLite fallback):`, {
                totalMessages: uniqueMessages.length,
                INITIAL_VISIBLE_MESSAGES,
                startIndex,
                willShowMessagesFrom: startIndex,
                willShowMessagesTo: uniqueMessages.length - 1,
              });
              setVisibleMessagesStartIndex(startIndex);
            }
            // ✅ CRITICAL FIX: When messages < INITIAL_VISIBLE_MESSAGES, visibleMessagesStartIndex stays null
            // This is correct - visibleMessages useMemo will show all messages
            // But initialScrollIndex will still be set to ensure FlatList starts at the bottom
            
            if (showLoading) {
              setLoading(false);
            }
          } else {
            // ❌ Both API and SQLite are empty - show empty state
            setMessages([]);
            messagesLengthRef.current = 0;
            setLoadedMessagesCount(0);
            
            if (showLoading) {
              setLoading(false);
            }
          }
        } catch (sqliteError) {
          console.error('[UserChat] Error loading from SQLite fallback:', sqliteError);
          // ❌ Both API and SQLite failed - show empty state
          setMessages([]);
          messagesLengthRef.current = 0;
          
          if (showLoading) {
            setLoading(false);
          }
        }
      } else {
        // ❌ API failed and no database - show empty state
        setMessages([]);
        messagesLengthRef.current = 0;
        
        if (showLoading) {
          setLoading(false);
        }
      }
      
      // Check if this is a network-related error that we should retry
      const isNetworkError = 
        !apiError?.response ||
        apiError?.code === 'ECONNABORTED' ||
        apiError?.message?.includes('Network Error') ||
        apiError?.message?.includes('timeout') ||
        apiError?.response?.status >= 500;
      
      const shouldRetry = isNetworkError && 
                         retryAttemptRef.current < MAX_RETRY_ATTEMPTS &&
                         !showLoading;
      
      if (shouldRetry) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryAttemptRef.current);
        retryAttemptRef.current += 1;
        
        if (__DEV__) {
          console.log(`[UserChat] Retrying fetchMessages (attempt ${retryAttemptRef.current}/${MAX_RETRY_ATTEMPTS}) in ${delay}ms`);
        }
        
        retryTimeoutRef.current = setTimeout(() => {
          fetchMessages(false);
        }, delay);
      } else {
        if (retryAttemptRef.current >= MAX_RETRY_ATTEMPTS) {
          if (__DEV__) {
            console.warn('[UserChat] Max retry attempts reached. Stopping background retries.');
          }
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
    // ✅ CRITICAL FIX: Don't poll if there are messages currently being sent (prevent race conditions)
    const messagesBeingSent = getMessagesBeingSent();
    if (
      isPollingRef.current ||
      loadingMore ||
      isPaginatingRef.current ||
      sending ||
      !latestMessageIdRef.current ||
      messagesBeingSent.size > 0
    ) {
      if (messagesBeingSent.size > 0 && __DEV__) {
        console.log(`[UserChat] ⏸️ Skipping poll - ${messagesBeingSent.size} message(s) being sent`);
      }
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
          // Add new messages to existing messages (append at end, they're already sorted)
          setMessages(prev => {
            // CRITICAL FIX: Use prev (current state) instead of stale closure 'messages'
            // Check for duplicates before adding - use comprehensive check
            const existingIds = new Set(prev.map(m => m.id).filter(id => id != null));
            const existingMessagesMap = new Map<number | string, Message>();
            prev.forEach(m => {
              if (m.id != null) {
                existingMessagesMap.set(m.id, m);
              }
            });
            
            // ✅ CRITICAL FIX: Improved deduplication - match by server_id, content+sender+timestamp, or ID
            const uniqueNewMessages = newMessages.filter(newMsg => {
              // Check 1: Same ID
              if (newMsg.id != null && existingIds.has(newMsg.id)) {
                return false; // Duplicate by ID
              }
              
              // Check 2: Match by server_id if message has server_id
              // This handles the case where UI has tempLocalId but API returns server_id
              if (newMsg.id != null) {
                const hasMatchingServerId = prev.some(existing => {
                  // If existing message has same server_id (stored in id field after sync)
                  // or if they're the same message with different IDs
                  return existing.id === newMsg.id;
                });
                
                if (hasMatchingServerId) {
                  return false; // Duplicate by server_id
                }
              }
              
              // Check 3: Same content + sender + timestamp (within 2 seconds) - exact duplicate
              // ✅ Increased time window to 2 seconds to catch messages that were just sent
              const isExactDuplicate = prev.some(existing => {
                if (existing.id === newMsg.id) return true; // Already checked above
                
                const timeDiff = Math.abs(
                  new Date(existing.created_at).getTime() - new Date(newMsg.created_at).getTime()
                );
                const contentMatch = (existing.message || '') === (newMsg.message || '');
                const senderMatch = existing.sender_id === newMsg.sender_id;
                
                // If same content, sender, and timestamp within 2 seconds, it's an exact duplicate
                return contentMatch && senderMatch && timeDiff < 2000;
              });
              
              return !isExactDuplicate;
            });
            
            if (uniqueNewMessages.length === 0) {
              return prev; // No new unique messages
            }
            
            // Process new messages to ensure reply_to data is structured
            // Use prev (current state) instead of stale closure
            const processedNewMessages = uniqueNewMessages.map((msg: any) => {
              if (msg.reply_to) {
                return msg;
              }
              
              if (msg.reply_to_id) {
                // Try to find replied message in existing messages (prev) or new messages
                const allMessages = [...prev, ...uniqueNewMessages];
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
            
            // Combine and sort all messages
            const allMessages = [...prev, ...processedNewMessages].sort((a: Message, b: Message) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            
            // CRITICAL: Always deduplicate (defense in depth)
            const uniqueMessages = deduplicateMessages(allMessages);
            
            // Update latest message ID
            if (uniqueMessages.length > 0) {
              const latestMsg = uniqueMessages[uniqueMessages.length - 1];
              latestMessageIdRef.current = latestMsg.id;
            }
            messagesLengthRef.current = uniqueMessages.length;
            
            return uniqueMessages; // Return deduplicated messages
          });
          
            // Auto-scroll to bottom when receiving new messages (only if user is at bottom)
            // maintainVisibleContentPosition will handle position maintenance automatically
            if (isAtBottomRef.current && !isInitialLoadRef.current) {
              requestAnimationFrame(() => {
                setTimeout(() => {
                  scrollToBottom(false, 0, false);
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
  }, [id, loadingMore, sending, hasScrolledToBottom, scrollToBottom]); // CRITICAL FIX: Removed 'messages' to prevent stale closure

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
    initialScrollCompleteRef.current = false; // Reset initial scroll flag
    isInitialLoadRef.current = true; // ✅ CRITICAL FIX: Set initial load flag when conversation changes
    setVisibleMessagesStartIndex(null); // Reset visible messages start index
    
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

  // Simplified scroll to bottom function - maintainVisibleContentPosition handles most cases
  const scrollToBottom = useCallback((animated = false, delay = 0, force = false) => {
    if (!flatListRef.current || messages.length === 0) {
      return;
    }
    
    const performScroll = () => {
      if (!flatListRef.current || messages.length === 0) {
        return;
      }
      
      try {
        // Simply scroll to end - maintainVisibleContentPosition will handle position maintenance
        (flatListRef.current as any).scrollToEnd({ animated });
            setHasScrolledToBottom(true);
        isAtBottomRef.current = true;
        
        // Update anchor message when scrolling to bottom
        if (messages.length > 0) {
          lastVisibleMessageIdRef.current = messages[messages.length - 1].id;
        }
          } catch (error) {
        console.warn('Scroll failed:', error);
      }
    };
    
    if (delay > 0) {
      setTimeout(performScroll, delay);
    } else {
      requestAnimationFrame(performScroll);
    }
  }, [messages.length]);

  // Reset scroll state when conversation changes
  useEffect(() => {
    if (hasScrolledForThisConversation.current !== id) {
      hasScrolledForThisConversation.current = id as string;
      setHasScrolledToBottom(false);
      isInitialLoadRef.current = true;
      isAtBottomRef.current = true;
      shouldMaintainPositionRef.current = false; // Reset on conversation change
      lastScrollOffsetRef.current = 0;
      lastVisibleMessageIdRef.current = null;
      viewportHeightRef.current = 0;
      lastMessageHeightRef.current = 0;
      lastMessageYPositionRef.current = 0;
      messageHeightsRef.current.clear(); // Clear message heights cache
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
  
  // ✅ DEBUG LOGGING: Track when visibleMessages changes
  useEffect(() => {
    console.log(`[UserChat] 🔄 visibleMessages changed:`, {
      count: visibleMessages.length,
      startIndex: visibleMessagesStartIndex,
      firstMessage: visibleMessages[0] ? {
        id: visibleMessages[0].id,
        content: visibleMessages[0].message?.substring(0, 30),
        created_at: visibleMessages[0].created_at,
      } : null,
      lastMessage: visibleMessages[visibleMessages.length - 1] ? {
        id: visibleMessages[visibleMessages.length - 1].id,
        content: visibleMessages[visibleMessages.length - 1].message?.substring(0, 30),
        created_at: visibleMessages[visibleMessages.length - 1].created_at,
      } : null,
    });
  }, [visibleMessages, visibleMessagesStartIndex]);

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
      
      // Reset scroll flag on focus if at bottom or initial load
      if (!loadingMore && !isPaginatingRef.current && currentPage === 1) {
        setHasScrolledToBottom(false);
        isAtBottomRef.current = true;
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
    isAtBottomRef.current = false;
    shouldMaintainPositionRef.current = false; // Don't maintain position when loading older messages
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
        const deduplicated = deduplicateMessages(allMessages.sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ));
        
        // Update visibleMessagesStartIndex to account for new older messages prepended
        // Since we're prepending, the start index needs to increase by the number of new messages
        if (visibleMessagesStartIndex !== null) {
          setVisibleMessagesStartIndex(prevIndex => {
            if (prevIndex === null) return null;
            // Increase start index by number of new messages to keep showing the same messages
            return prevIndex + uniqueNewMessages.length;
          });
        }
        
        return deduplicated;
      });
      
      setCurrentPage(nextPage);
      const hasMore = pagination.current_page < pagination.last_page || 
                     (apiMessages.length >= MESSAGES_PER_PAGE);
      setHasMoreMessages(hasMore);
      
      // BACKGROUND SYNC: Save to SQLite for offline access
      if (dbInitialized) {
        try {
          await syncOlderMessages(Number(id), 'individual', nextPage, MESSAGES_PER_PAGE, user?.id || 0);
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
      // ✅ CRITICAL FIX: Mark message as sending BEFORE saving to SQLite
      // This prevents retry service from picking it up before handleSend sends it
      console.log(`[UserChat] 🔒 Marking message ${tempLocalId} as sending BEFORE SQLite save | Content: "${messageText?.substring(0, 50)}"`);
      markMessageAsSending(tempLocalId);
      
      // STEP 1: Save to SQLite first with pending status (instant local storage)
      let actualMessageId = tempLocalId; // Will be updated if SQLite assigns different ID
      if (dbInitialized) {
        try {
          await saveDbMessages([{
            id: tempLocalId, // ✅ CRITICAL: Provide tempLocalId so saveMessages uses it
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
          
          // ✅ CRITICAL FIX: Verify the message was saved with the correct ID
          // If saveMessages used auto-increment, we need to get the actual ID
          try {
            const database = await getDb();
            if (database) {
              const savedMessage = await database.getFirstAsync<{ id: number }>(
                `SELECT id FROM messages 
                 WHERE conversation_id = ? 
                 AND sender_id = ? 
                 AND message = ? 
                 AND created_at = ? 
                 AND sync_status = 'pending'
                 ORDER BY id DESC
                 LIMIT 1`,
                [Number(id), Number(user?.id || 0), messageText || null, now]
              );
              
              if (savedMessage) {
                actualMessageId = savedMessage.id;
                if (actualMessageId !== tempLocalId) {
                  console.log(`[UserChat] ⚠️ ID MISMATCH: tempLocalId=${tempLocalId}, SQLite ID=${actualMessageId}. Updating marking.`);
                  // Update marking to use SQLite ID
                  unmarkMessageAsSending(tempLocalId);
                  markMessageAsSending(actualMessageId);
                } else {
                  console.log(`[UserChat] ✅ Message saved with tempLocalId: ${tempLocalId}`);
                }
              }
            }
          } catch (idCheckError) {
            console.warn(`[UserChat] Could not verify SQLite ID, using tempLocalId:`, idCheckError);
          }
          
          if (__DEV__ || process.env.EXPO_PUBLIC_DEBUG_API === 'true') {
            console.log('[UserChat] Saved message to SQLite with pending status:', {
              tempLocalId,
              actualMessageId,
              message: messageText?.substring(0, 50),
              conversationId: Number(id),
              timestamp: now,
            });
          }
        } catch (dbError: any) {
          // ✅ CRITICAL: Log detailed error information for debugging
          console.error('[UserChat] Error saving to SQLite:', {
            error: dbError?.message || String(dbError),
            tempLocalId,
            message: messageText?.substring(0, 50),
            conversationId: Number(id),
            stack: dbError?.stack,
          });
          // Continue anyway - we'll still try to send to API
          // But the message won't persist if DB save fails
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
        
        // Scroll to bottom after sending
        isAtBottomRef.current = true;
        shouldMaintainPositionRef.current = true;
        if (uniqueMessages.length > 0) {
          lastVisibleMessageIdRef.current = uniqueMessages[uniqueMessages.length - 1].id;
        }
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
      
      // STEP 3: Send to API in background (non-blocking) with immediate retry
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
                  // Update UI with server ID and server timestamp
                  setMessages(prev => prev.map(msg => 
                    msg.id === tempLocalId 
                      ? { 
                          ...msg, 
                          id: existingMessage.server_id!, 
                          sync_status: 'synced',
                          created_at: existingMessage.created_at || msg.created_at
                        }
                      : msg
                  ));
                  return; // Don't send again
                }
              }
            } catch (checkError) {
              // Continue with send if check fails
            }
          }
          
          // Prepare FormData
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

          // ✅ SIMPLIFIED: Send once, let retry service handle failures and verification
          try {
            // ✅ CRITICAL: Double-check message is still marked as sending before API call
            // Check both tempLocalId and actualMessageId
            const isMarked = isMessageBeingSent(tempLocalId) || isMessageBeingSent(actualMessageId);
            if (!isMarked) {
              console.warn(`[UserChat] ⚠️ Message ${actualMessageId} (tempLocalId: ${tempLocalId}) was unmarked before send - marking again`);
              markMessageAsSending(actualMessageId);
            }
            
            // ✅ LOGGING: Log API send attempt
            const sendStartTime = Date.now();
            console.log(`[UserChat] 📤 SENDING message ${actualMessageId} (tempLocalId: ${tempLocalId}) to API | Content: "${messageText?.substring(0, 50)}" | Marked as sending: ${isMarked}`);
            
            // Send to API (single attempt - no retries)
            const res = await messagesAPI.sendMessage(formData);
            
            const sendDuration = Date.now() - sendStartTime;
            console.log(`[UserChat] 📥 API RESPONSE for message ${actualMessageId} (tempLocalId: ${tempLocalId}) | Status: ${res.status} | Duration: ${sendDuration}ms`);
            
            // Check if status indicates success
            if (res.status >= 200 && res.status < 300) {
              console.log(`[UserChat] ✅ API SEND SUCCESS for message ${actualMessageId} (tempLocalId: ${tempLocalId}) | Status: ${res.status}`);
              
              // Try to extract message ID from response
              let messageId: number | undefined;
              let serverCreatedAt: string | undefined;
              
              if (res.data) {
                if (res.data.id) {
                  messageId = res.data.id;
                  serverCreatedAt = res.data.created_at;
                } else if (res.data.data?.id) {
                  messageId = res.data.data.id;
                  serverCreatedAt = res.data.data.created_at;
                } else if (res.data.message?.id) {
                  messageId = res.data.message.id;
                  serverCreatedAt = res.data.message.created_at;
                } else if (res.data.message_id) {
                  messageId = res.data.message_id;
                  serverCreatedAt = res.data.created_at || res.data.message_created_at;
                } else if (res.data.result?.id) {
                  messageId = res.data.result.id;
                  serverCreatedAt = res.data.result.created_at;
                }
              }
              
              if (messageId) {
                console.log(`[UserChat] 📋 Extracted server_id ${messageId} from API response for message ${actualMessageId} (tempLocalId: ${tempLocalId})`);
              } else {
                console.warn(`[UserChat] ⚠️ No messageId found in API response for message ${actualMessageId} | Response structure:`, JSON.stringify(res.data).substring(0, 200));
              }
              
              // ✅ If we got messageId from response, update immediately
              if (messageId && dbInitialized) {
                try {
                  // ✅ CRITICAL FIX: Use actualMessageId (SQLite ID) instead of tempLocalId
                  const messageIdToUpdate = actualMessageId;
                  
                  // Check for duplicate before updating
                  const database = await getDb();
                  if (database) {
                    const existingByServerId = await database.getFirstAsync<{ id: number }>(
                      `SELECT id FROM messages WHERE server_id = ? AND id != ?`,
                      [messageId, messageIdToUpdate]
                    );
                    
                    if (existingByServerId) {
                      // Duplicate exists - remove messageIdToUpdate message
                      await database.runAsync(`DELETE FROM messages WHERE id = ?`, [messageIdToUpdate]);
                      setMessages(prev => prev.filter(msg => msg.id !== tempLocalId && msg.id !== messageIdToUpdate));
                      unmarkMessageAsSending(tempLocalId);
                      unmarkMessageAsSending(messageIdToUpdate);
                      return;
                    }
                  }
                  
                  // ✅ CRITICAL FIX: Wait for updateMessageStatus to complete and check return value
                  console.log(`[UserChat] 💾 Updating message ${messageIdToUpdate} (tempLocalId: ${tempLocalId}) status to synced with server_id ${messageId}`);
                  const updateStartTime = Date.now();
                  
                  const updateSucceeded = await updateMessageStatus(messageIdToUpdate, messageId, 'synced', serverCreatedAt);
                  const updateDuration = Date.now() - updateStartTime;
                  
                  if (updateSucceeded) {
                    console.log(`[UserChat] ✅ DATABASE UPDATE SUCCESS for message ${messageIdToUpdate} | server_id: ${messageId} | Duration: ${updateDuration}ms`);
                    // Update UI message with server ID
                    setMessages(prev => {
                      const existingIds = new Set(prev.map(m => m.id));
                      const serverIdExists = existingIds.has(messageId);
                      
                      // ✅ CRITICAL FIX: Find message by both tempLocalId AND actualMessageId
                      const messageToUpdate = prev.find(msg => 
                        msg.id === tempLocalId || msg.id === actualMessageId
                      );
                      
                      if (serverIdExists && messageToUpdate) {
                        // Server ID already exists (from polling), remove tempLocalId/actualMessageId to avoid duplication
                        console.log(`[UserChat] 🔄 Server ID ${messageId} already exists in UI, removing tempLocalId ${tempLocalId} and actualMessageId ${actualMessageId}`);
                        const filtered = prev.filter(msg => 
                          msg.id !== tempLocalId && msg.id !== actualMessageId
                        );
                        return deduplicateMessages(filtered);
                      } else if (messageToUpdate) {
                        // Update tempLocalId/actualMessageId to server ID
                        console.log(`[UserChat] 🔄 Updating message ${tempLocalId}/${actualMessageId} to server_id ${messageId}`);
                        const updated = prev.map(msg => 
                          (msg.id === tempLocalId || msg.id === actualMessageId)
                            ? { 
                                ...msg, 
                                id: messageId, 
                                sync_status: 'synced',
                                created_at: serverCreatedAt || msg.created_at
                              }
                            : msg
                        );
                        return deduplicateMessages(updated);
                      } else {
                        // Message not found in UI (might have been removed by polling)
                        // Add it back with server_id
                        console.log(`[UserChat] ⚠️ Message ${tempLocalId}/${actualMessageId} not found in UI, adding with server_id ${messageId}`);
                        const newMessage: Message = {
                          id: messageId,
                          message: messageText || null,
                          sender_id: Number(user?.id || 0),
                          receiver_id: Number(id),
                          created_at: serverCreatedAt || now,
                          sync_status: 'synced',
                          attachments: localMessage.attachments || [],
                        };
                        const updated = [...prev, newMessage].sort((a, b) => 
                          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                        );
                        return deduplicateMessages(updated);
                      }
                    });
                    
                    latestMessageIdRef.current = messageId;
                  } else {
                    console.error(`[UserChat] ❌ DATABASE UPDATE FAILED for message ${messageIdToUpdate} | server_id: ${messageId} | Duration: ${updateDuration}ms | Will be retried by retry service`);
                  }
                  
                  // ✅ CRITICAL FIX: Only unmark AFTER updateMessageStatus completes
                  // This prevents retry service from picking it up before status is updated
                  console.log(`[UserChat] 🔓 Unmarking message ${messageIdToUpdate} (tempLocalId: ${tempLocalId}) as sending (update completed)`);
                  unmarkMessageAsSending(tempLocalId);
                  unmarkMessageAsSending(messageIdToUpdate); // Also unmark SQLite ID
                } catch (updateError) {
                  console.error('[UserChat] Error updating message status:', updateError);
                  // ✅ Unmark even on error so retry service can handle it
                  unmarkMessageAsSending(tempLocalId);
                  unmarkMessageAsSending(actualMessageId);
                }
              } else {
                // No messageId in response - leave as pending, retry service will verify and update
                console.warn(`[UserChat] ⚠️ API SUCCESS but NO messageId for message ${actualMessageId} (tempLocalId: ${tempLocalId}) | Leaving as pending for retry service`);
                unmarkMessageAsSending(tempLocalId);
                unmarkMessageAsSending(actualMessageId);
              }
            } else {
              // Non-success status - leave as pending, retry service will retry
              console.error(`[UserChat] ❌ API SEND FAILED for message ${actualMessageId} (tempLocalId: ${tempLocalId}) | Status: ${res.status} | Leaving as pending for retry service`);
              unmarkMessageAsSending(tempLocalId);
              unmarkMessageAsSending(actualMessageId); // ✅ Unmark so retry service can retry
            }
          } catch (apiError: any) {
            // Check if it's a client error (4xx) - mark as failed
            const isClientError = apiError.response?.status >= 400 && apiError.response?.status < 500;
            
            console.error(`[UserChat] ❌ API SEND EXCEPTION for message ${actualMessageId} (tempLocalId: ${tempLocalId}) | Error: ${apiError.message} | Status: ${apiError.response?.status} | IsClientError: ${isClientError}`);
            
            if (isClientError) {
              // Client error (4xx) - mark as failed immediately
              console.log(`[UserChat] 🚫 Marking message ${actualMessageId} as failed (4xx error)`);
              if (dbInitialized) {
                await updateMessageStatus(actualMessageId, undefined, 'failed');
                setMessages(prev => prev.map(msg => 
                  (msg.id === tempLocalId || msg.id === actualMessageId)
                    ? { ...msg, sync_status: 'failed' }
                    : msg
                ));
              }
              unmarkMessageAsSending(tempLocalId);
              unmarkMessageAsSending(actualMessageId); // ✅ Unmark
            } else {
              // Network error or other - leave as pending, retry service will retry
              console.log(`[UserChat] 🔄 Leaving message ${actualMessageId} as pending (network error, will retry)`);
              unmarkMessageAsSending(tempLocalId);
              unmarkMessageAsSending(actualMessageId); // ✅ Unmark so retry service can retry
            }
          }
          
          // Update last_seen_at
          try {
            await usersAPI.updateLastSeen();
          } catch (error) {
            // Silently fail
          }
          
        } catch (e: unknown) {
          const error = e as any;
          console.error('[UserChat] Unexpected error in handleSend:', error);
          
          // Ensure message is kept as pending for retry
          if (dbInitialized) {
            await updateMessageStatus(actualMessageId, undefined, 'pending');
            setMessages(prev => prev.map(msg => 
              (msg.id === tempLocalId || msg.id === actualMessageId)
                ? { ...msg, sync_status: 'pending' }
                : msg
            ));
          }
          unmarkMessageAsSending(tempLocalId);
          unmarkMessageAsSending(actualMessageId); // ✅ Unmark so retry service can pick it up
        } finally {
          // ✅ CRITICAL FIX: Always unmark message as being sent, even if something goes wrong
          unmarkMessageAsSending(tempLocalId);
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
    const previousMessage = index > 0 ? visibleMessages[index - 1] : null;
    const showDateSeparator = shouldShowDateSeparator(item, previousMessage);
    const isLastMessage = index === visibleMessages.length - 1; // Track if this is the last visible message
    
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
        <View
          onLayout={(event) => {
            // Measure voice message height
            const { height, y } = event.nativeEvent.layout;
            messageHeightsRef.current.set(item.id, height);
            
            // If this is the last message, track its position
            if (isLastMessage) {
              lastMessageHeightRef.current = height;
              lastMessageYPositionRef.current = y;
              
              if (viewportHeightRef.current > 0 && shouldMaintainPositionRef.current) {
                const targetScrollOffset = y + height + targetBottomOffsetRef.current - viewportHeightRef.current;
                setTimeout(() => {
                  if (flatListRef.current && shouldMaintainPositionRef.current) {
                    try {
                      flatListRef.current.scrollToOffset({
                        offset: Math.max(0, targetScrollOffset),
                        animated: false
                      });
                    } catch (error) {
                      // Silently handle
                    }
                  }
                }, 10);
              }
            }
          }}
        >
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
              syncStatus={item.sync_status || 'pending'}
          />
        </TouchableOpacity>
        </View>
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
            onLayout={(event) => {
              // Measure message height for precise scroll calculations
              const { height, y } = event.nativeEvent.layout;
              messageHeightsRef.current.set(item.id, height);
              
              // If this is the last message, track its position and height
              if (isLastMessage) {
                lastMessageHeightRef.current = height;
                lastMessageYPositionRef.current = y;
                
                // Calculate target scroll offset to keep message at fixed position from bottom
                if (viewportHeightRef.current > 0 && shouldMaintainPositionRef.current) {
                  // Calculate the exact offset needed to keep last message at targetBottomOffsetRef from bottom
                  const targetScrollOffset = y + height + targetBottomOffsetRef.current - viewportHeightRef.current;
                  
                  // Apply scroll offset after a small delay to ensure layout is complete
                  setTimeout(() => {
                    if (flatListRef.current && shouldMaintainPositionRef.current) {
                      try {
                        flatListRef.current.scrollToOffset({
                          offset: Math.max(0, targetScrollOffset),
                          animated: false
                        });
                      } catch (error) {
                        // Silently handle - scroll might not be ready yet
                      }
                    }
                  }, 10);
                }
              }
            }}
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
                      syncStatus={item.sync_status || 'pending'}
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
                      syncStatus={item.sync_status || 'pending'}
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
              data={visibleMessages}
              renderItem={renderItem}
              extraData={messages.length} // Force re-render when messages array changes
              initialNumToRender={30} // Render 30 items initially for better performance
              windowSize={10} // Keep 10 screens worth of items in memory (optimized)
              maxToRenderPerBatch={15} // Render 15 items per batch
              removeClippedSubviews={true} // Remove off-screen views for better performance
              updateCellsBatchingPeriod={50} // Batch updates every 50ms
              // ✅ CRITICAL FIX: Always start at the last message (latest at bottom) on initial load
              // This ensures the latest message is visible even when all messages fit on screen
              initialScrollIndex={
                isInitialLoadRef.current && visibleMessages.length > 0 
                  ? visibleMessages.length - 1  // Always start at last message on initial load
                  : undefined
              }
              getItemLayout={(data, index) => {
                // Provide item layout for better scrollToIndex performance
                // CRITICAL: This must be accurate for initialScrollIndex to work properly
                // Estimate ~60px per message (will be adjusted by onLayout)
                const estimatedHeight = 60; // Base height per message
                return { 
                  length: estimatedHeight, 
                  offset: estimatedHeight * index, 
                  index 
                };
              }}
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
              inverted={false} // Normal scrolling - latest messages at bottom (correct for chat apps)
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              // CRITICAL: Maintain scroll position relative to last visible message
              // This handles image loading, polling refetch, and content changes automatically
              maintainVisibleContentPosition={
                initialScrollCompleteRef.current ? {
                  minIndexForVisible: 0, // Start maintaining from first item
                  autoscrollToTopThreshold: 10, // Auto-scroll to top if less than 10 items visible
                } : undefined
              }
              onScroll={({ nativeEvent }) => {
                const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
                
                // Track viewport height for precise calculations
                viewportHeightRef.current = layoutMeasurement.height;
                
                // Track scroll offset for pagination
                const currentOffset = contentOffset.y;
                lastScrollOffsetRef.current = currentOffset;
                
                // Calculate if user is at bottom (within 50px threshold)
                const contentHeight = contentSize.height;
                const viewportHeight = layoutMeasurement.height;
                const distanceFromBottom = contentHeight - (currentOffset + viewportHeight);
                const isAtBottom = distanceFromBottom <= 50;
                
                // ✅ DEBUG LOGGING: Track scroll position (especially on initial load)
                if (isInitialLoadRef.current || !initialScrollCompleteRef.current) {
                  console.log(`[UserChat] 📜 onScroll (initial load):`, {
                    contentOffsetY: currentOffset,
                    contentHeight,
                    viewportHeight,
                    distanceFromBottom,
                    isAtBottom,
                    scrollPercentage: contentHeight > 0 ? ((currentOffset / (contentHeight - viewportHeight)) * 100).toFixed(1) + '%' : '0%',
                    isInitialLoad: isInitialLoadRef.current,
                    initialScrollComplete: initialScrollCompleteRef.current,
                    visibleMessagesCount: visibleMessages.length,
                    messagesCount: messages.length,
                  });
                }
                
                // Update anchor message and position maintenance flag when user is at bottom
                if (isAtBottom && visibleMessages.length > 0) {
                  isAtBottomRef.current = true;
                  shouldMaintainPositionRef.current = true;
                  lastVisibleMessageIdRef.current = visibleMessages[visibleMessages.length - 1].id;
                } else {
                  isAtBottomRef.current = false;
                  shouldMaintainPositionRef.current = false;
                }
                
                // Load more messages when at top (pagination)
                const isAtTop = contentOffset.y <= 50;
                const now = Date.now();
                if (isAtTop && hasMoreMessages && !loadingMore && (now - lastScrollTrigger > 2000)) {
                  setLastScrollTrigger(now);
                  loadMoreMessages();
                }
              }}
              onScrollEndDrag={({ nativeEvent }) => {
                const { contentOffset } = nativeEvent;
                const isAtTop = contentOffset.y <= 50;
                
                // Show more messages when scrolling up (if we're showing only last N messages)
                if (isAtTop && visibleMessagesStartIndex !== null && visibleMessagesStartIndex > 0) {
                  // Show more older messages (decrease start index)
                  const newStartIndex = Math.max(0, visibleMessagesStartIndex - INITIAL_VISIBLE_MESSAGES);
                  setVisibleMessagesStartIndex(newStartIndex);
                }
                
                // Load more messages from API when at top and we've shown all loaded messages
                const now = Date.now();
                if (isAtTop && visibleMessagesStartIndex === 0 && hasMoreMessages && !loadingMore && (now - lastScrollTrigger > 2000)) {
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
                // ✅ DEBUG LOGGING: Track content size changes
                const viewportHeight = viewportHeightRef.current || 0;
                const scrollPosition = lastScrollOffsetRef.current || 0;
                const distanceFromBottom = contentHeight - (scrollPosition + viewportHeight);
                const scrollPercentage = contentHeight > viewportHeight 
                  ? ((scrollPosition / (contentHeight - viewportHeight)) * 100).toFixed(1) + '%'
                  : '0% (all visible)';
                
                console.log(`[UserChat] 📏 onContentSizeChange:`, {
                  contentWidth,
                  contentHeight,
                  viewportHeight,
                  scrollPosition,
                  distanceFromBottom,
                  scrollPercentage,
                  isAtTop: scrollPosition <= 10,
                  isAtBottom: distanceFromBottom <= 50,
                  messagesCount: messages.length,
                  visibleMessagesCount: visibleMessages.length,
                  visibleMessagesStartIndex,
                  isInitialLoad: isInitialLoadRef.current,
                  initialScrollComplete: initialScrollCompleteRef.current,
                  loading,
                  hasScrolledToBottom,
                  isAtBottom: isAtBottomRef.current,
                  firstVisibleMessageId: visibleMessages[0]?.id,
                  lastVisibleMessageId: visibleMessages[visibleMessages.length - 1]?.id,
                  shouldMaintainPosition: shouldMaintainPositionRef.current,
                  lastMessageHeight: lastMessageHeightRef.current,
                  // Calculate which message should be visible at current scroll position
                  estimatedVisibleRange: viewportHeight > 0 && visibleMessages.length > 0 ? {
                    estimatedFirstVisibleIndex: Math.floor((scrollPosition / contentHeight) * visibleMessages.length),
                    estimatedLastVisibleIndex: Math.floor(((scrollPosition + viewportHeight) / contentHeight) * visibleMessages.length),
                  } : null,
                });
                
                // ✅ CRITICAL FIX: On initial load, always scroll to bottom when messages are set
                // This handles the case where initialScrollIndex worked, but then messages update and push content down
                if (isInitialLoadRef.current && !loading && visibleMessages.length > 0) {
                  // Check if we're not at bottom (content grew and pushed us up)
                  const isAtBottom = distanceFromBottom <= 100;
                  
                  if (!isAtBottom || !initialScrollCompleteRef.current) {
                    console.log(`[UserChat] 🔄 Initial load - content changed, scrolling to bottom`, {
                      contentHeight,
                      viewportHeight,
                      distanceFromBottom,
                      isAtBottom,
                      initialScrollComplete: initialScrollCompleteRef.current,
                    });
                    
                    // Scroll to bottom to keep latest message visible
                    setTimeout(() => {
                      if (flatListRef.current && visibleMessages.length > 0) {
                        try {
                          // Use scrollToEnd for inverted=false FlatList
                          (flatListRef.current as any).scrollToEnd({ animated: false });
                          console.log(`[UserChat] ✅ Scrolled to bottom after content change`);
                          
                          // Mark as complete after scroll
                          initialScrollCompleteRef.current = true;
                          setHasScrolledToBottom(true);
                          isAtBottomRef.current = true;
                          shouldMaintainPositionRef.current = true;
                          
                          setTimeout(() => {
                            isInitialLoadRef.current = false;
                            console.log(`[UserChat] ✅ Marked initial load as complete`);
                          }, 300);
                        } catch (scrollError: any) {
                          console.warn(`[UserChat] ⚠️ Scroll to end failed:`, scrollError?.message);
                        }
                      }
                    }, 100); // Small delay to ensure content is rendered
                    return; // Exit early, don't run maintain position logic during initial load
                  }
                }
                
                // Maintain fixed position of last message when content changes (polling, refetch, image loading)
                // This only runs AFTER initial load is complete
                if (shouldMaintainPositionRef.current && 
                    !isInitialLoadRef.current && 
                    initialScrollCompleteRef.current &&
                    lastMessageHeightRef.current > 0 && 
                    viewportHeightRef.current > 0 &&
                    messages.length > 0) {
                  
                  // Calculate exact scroll offset to keep last message at fixed position from bottom
                  // Formula: contentHeight - viewportHeight - targetBottomOffset
                  const targetScrollOffset = contentHeight - viewportHeightRef.current - targetBottomOffsetRef.current;
                  
                  setTimeout(() => {
                    if (flatListRef.current && shouldMaintainPositionRef.current) {
                      try {
                        flatListRef.current.scrollToOffset({
                          offset: Math.max(0, targetScrollOffset),
                          animated: false
                        });
                      } catch (error) {
                        // Silently handle - might be during layout
                      }
                    }
                  }, 50); // Small delay to ensure layout is complete
                }
                
                // ✅ CRITICAL FIX: Scroll to bottom on initial load to show latest messages (at bottom)
                // This is a fallback for when the above logic doesn't catch it
                // Check if we need to scroll: initial load AND not already scrolled AND messages exist
                const needsInitialScroll = isInitialLoadRef.current && !loading && visibleMessages.length > 0 && !initialScrollCompleteRef.current;
                // Also check if scroll is not at bottom (distanceFromBottom > 100px) - this handles the case where initialScrollComplete is true but scroll didn't happen
                const isNearBottom = distanceFromBottom <= 100; // Within 100px of bottom
                const shouldScrollToBottom = needsInitialScroll || (isInitialLoadRef.current && !isNearBottom && visibleMessages.length > 0 && !initialScrollCompleteRef.current);
                
                if (shouldScrollToBottom) {
                  console.log(`[UserChat] ✅ Initial load - scrolling to bottom to show latest messages`, {
                    isInitialLoad: isInitialLoadRef.current,
                    initialScrollComplete: initialScrollCompleteRef.current,
                    scrollPosition,
                    contentHeight,
                    viewportHeight,
                    distanceFromBottom,
                    isNearBottom,
                    needsInitialScroll,
                    shouldScrollToBottom,
                  });
                  
                  // Use scrollToIndex to scroll to the last message (latest at bottom)
                  setTimeout(() => {
                    if (flatListRef.current && visibleMessages.length > 0) {
                      try {
                        const lastIndex = visibleMessages.length - 1;
                        console.log(`[UserChat] 📜 Scrolling to index ${lastIndex} (latest message at bottom)`);
                        flatListRef.current.scrollToIndex({
                          index: lastIndex,
                          animated: false,
                          viewPosition: 1, // 1 = bottom of viewport (latest message visible)
                        });
                        console.log(`[UserChat] ✅ Scrolled to bottom successfully`);
                      } catch (scrollError: any) {
                        // If scrollToIndex fails, fallback to scrollToEnd
                        console.warn(`[UserChat] ⚠️ scrollToIndex failed, using scrollToEnd:`, scrollError?.message);
                        try {
                          (flatListRef.current as any).scrollToEnd({ animated: false });
                          console.log(`[UserChat] ✅ Used scrollToEnd fallback`);
                        } catch (endError) {
                          console.error(`[UserChat] ❌ Both scroll methods failed:`, endError);
                        }
                      }
                    }
                  }, 300); // Increased delay to ensure messages are fully rendered
                  
                  // ✅ CRITICAL FIX: Only mark as complete AFTER scroll is attempted
                  initialScrollCompleteRef.current = true;
                  setHasScrolledToBottom(true);
                  isAtBottomRef.current = true;
                  shouldMaintainPositionRef.current = true;
                  if (visibleMessages.length > 0) {
                    lastVisibleMessageIdRef.current = visibleMessages[visibleMessages.length - 1].id;
                    console.log(`[UserChat] 📌 Set lastVisibleMessageIdRef to: ${lastVisibleMessageIdRef.current}`);
                    
                    // ✅ CRITICAL FIX: Set isInitialLoad to false AFTER scroll is initiated
                    // This prevents it from being false before scroll happens
                    setTimeout(() => {
                      isInitialLoadRef.current = false;
                      console.log(`[UserChat] ✅ Marked initial load as complete after scroll`);
                    }, 500); // Wait for scroll to complete
                  }
                }
              }}
              onLayout={(event) => {
                // Track viewport height when layout changes
                const { height, width, x, y } = event.nativeEvent.layout;
                const previousViewportHeight = viewportHeightRef.current;
                
                // ✅ DEBUG LOGGING: Track layout changes
                console.log(`[UserChat] 📐 FlatList onLayout:`, {
                  height,
                  width,
                  x,
                  y,
                  previousViewportHeight,
                  heightChanged: previousViewportHeight !== height,
                  isInitialLoad: isInitialLoadRef.current,
                  initialScrollComplete: initialScrollCompleteRef.current,
                  visibleMessagesCount: visibleMessages.length,
                  messagesCount: messages.length,
                  visibleMessagesStartIndex,
                  // Check if FlatList is ready to show content
                  flatListRefExists: !!flatListRef.current,
                  // Estimate how many messages fit in viewport (rough estimate: ~60px per message)
                  estimatedMessagesInViewport: Math.ceil(height / 60),
                });
                
                viewportHeightRef.current = height;
                
                // ✅ DEBUG: Log initial scroll position after layout
                if (isInitialLoadRef.current && !initialScrollCompleteRef.current && flatListRef.current) {
                  setTimeout(() => {
                    // Try to get current scroll position
                    if (flatListRef.current) {
                      console.log(`[UserChat] 🔍 Initial layout complete - checking scroll state:`, {
                        viewportHeight: height,
                        visibleMessagesCount: visibleMessages.length,
                        firstMessageId: visibleMessages[0]?.id,
                        lastMessageId: visibleMessages[visibleMessages.length - 1]?.id,
                        note: 'FlatList with inverted=true shows last item (latest message) at bottom by default',
                      });
                    }
                  }, 100);
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
              ? (keyboardHeight > 0 ? 0 : Math.max(insets.bottom, 8)) // ✅ No padding when keyboard is open - KeyboardAvoidingView handles it
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