import GroupAvatar from '@/components/GroupAvatar';
import LinkText from '@/components/LinkText';
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
import { groupsAPI, messagesAPI, usersAPI } from '@/services/api';
import { deleteMessage as deleteDbMessage, getDb, getMessages as getDbMessages, hasMessagesForConversation, initDatabase, saveMessages as saveDbMessages, updateMessageByServerId, updateMessageStatus } from '@/services/database';
import { startRetryService, retryPendingMessages, markMessageAsSending, unmarkMessageAsSending, isMessageBeingSent, getMessagesBeingSent } from '@/services/messageRetryService';
import { syncConversationMessages } from '@/services/syncService';
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
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editText, setEditText] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

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
          console.log(`[GroupChat] Deduplication safety net: Removed ${messages.length - deduplicated.length} duplicate messages`);
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

  const flatListRef = useRef<FlatList>(null);
  const hasScrolledForThisConversation = useRef<string | null>(null); // Track which conversation we've scrolled for
  
  // Background retry state - track retry attempts and timeout
  const retryAttemptRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messagesLengthRef = useRef<number>(0); // Track messages length for retry logic
  const isPaginatingRef = useRef<boolean>(false); // Track if user is currently paginating (loading older messages)
  const lastFocusTimeRef = useRef<number>(0); // Track when screen last gained focus
  
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
  
  // Background sync state - for checking new messages (uses sync service + SQLite)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const latestMessageIdRef = useRef<number | null>(null); // Track latest message ID to detect new messages
  const isPollingRef = useRef<boolean>(false); // Track if sync is active
  const POLLING_INTERVAL = 3000; // Sync every 3 seconds
  const MAX_RETRY_ATTEMPTS = 5; // Maximum retry attempts
  const INITIAL_RETRY_DELAY = 1000; // Start with 1 second delay
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastScrollTrigger, setLastScrollTrigger] = useState(0);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
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
        console.error('[GroupChat] Failed to initialize database:', error);
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

  // Load messages from local database first (instant display)
  const loadMessagesFromDb = useCallback(async (limit: number = MESSAGES_PER_PAGE, offset: number = 0): Promise<Message[]> => {
    try {
      if (!dbInitialized) return [];
      
      const dbMessages = await getDbMessages(Number(id), 'group', limit, offset);
      
      // Transform database format to UI format
      return dbMessages.map(msg => ({
        id: msg.server_id || msg.id,
        message: msg.message || '',
        sender_id: msg.sender_id,
        group_id: msg.group_id || Number(id),
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
      console.error('[GroupChat] Error loading messages from database:', error);
      return [];
    }
  }, [id, dbInitialized]);

  // Fetch messages
  // ✅ API-FIRST STRATEGY: Try API first, fallback to SQLite only if API fails
  const fetchMessages = useCallback(async (showLoading = true) => {
    setHasScrolledToBottom(false); // Reset scroll flag when fetching new messages
    
    // Show loading spinner if requested
    if (showLoading) {
      setLoading(true);
    }
    
    // STEP 1: Try API first (source of truth)
    let apiSuccess = false;
    let apiMessages: Message[] = [];
    let apiError: any = null;
    
    try {
      // Fetch messages from API (comprehensive data)
      const response = await messagesAPI.getByGroup(Number(id), 1, 50);
      const messagesData = response.data.messages?.data || response.data.messages || [];
      const pagination = response.data.messages || {};
      
      setHasMoreMessages(pagination.current_page < pagination.last_page);
      
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
            conversation_type: 'group' as const,
            sender_id: msg.sender_id,
            group_id: Number(id),
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
          console.error('[GroupChat] Error saving messages to database:', dbError);
        }
      }
      
      // Set group info
      setGroupInfo(response.data.selectedConversation);
      
      // Mark messages as read
      const groupId = Number(id);
      if (ENABLE_MARK_AS_READ) {
        try {
          await groupsAPI.markMessagesAsRead(groupId);
          updateUnreadCount(groupId, 0);
        } catch (error: any) {
          const statusCode = error?.response?.status;
          if (statusCode !== 429 && statusCode !== 422 && statusCode !== 404) {
            if (__DEV__) {
              console.log('markMessagesAsRead failed for group:', statusCode || error?.message || error);
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
      console.error('[GroupChat] API fetch failed:', error);
    }
    
    // STEP 2: Handle API result or fallback to SQLite
    if (apiSuccess) {
      // ✅ API succeeded - use API data (even if empty, it's the truth)
      setMessages(apiMessages);
      messagesLengthRef.current = apiMessages.length;
      setLoadedMessagesCount(apiMessages.length);
      
      if (apiMessages.length > 0) {
        const latestMsg = apiMessages[apiMessages.length - 1];
        latestMessageIdRef.current = latestMsg.id;
      }
      
      if (showLoading) {
        setLoading(false);
      }
      
      setHasScrolledToBottom(false);
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
            
            if (showLoading) {
              setLoading(false);
            }
            
            setHasScrolledToBottom(false);
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
          console.error('[GroupChat] Error loading from SQLite fallback:', sqliteError);
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
          console.log(`[GroupChat] Retrying fetchMessages (attempt ${retryAttemptRef.current}/${MAX_RETRY_ATTEMPTS}) in ${delay}ms`);
        }
        
        retryTimeoutRef.current = setTimeout(() => {
          fetchMessages(false);
        }, delay);
      } else {
        if (retryAttemptRef.current >= MAX_RETRY_ATTEMPTS) {
          if (__DEV__) {
            console.warn('[GroupChat] Max retry attempts reached. Stopping background retries.');
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
  
  // Background sync for new messages - uses sync service and SQLite (no duplication)
  const syncForNewMessages = useCallback(async () => {
    // Don't sync if:
    // 1. Already syncing (prevent concurrent syncs)
    // 2. User is loading more messages (pagination)
    // 3. User is sending a message
    // 4. No latest message ID tracked yet
    // 5. Database not initialized
    // 6. ✅ CRITICAL FIX: Don't sync if there are messages currently being sent (prevent race conditions)
    const messagesBeingSent = getMessagesBeingSent();
    if (
      isPollingRef.current ||
      loadingMore ||
      isPaginatingRef.current ||
      sending ||
      !latestMessageIdRef.current ||
      !dbInitialized ||
      messagesBeingSent.size > 0
    ) {
      if (messagesBeingSent.size > 0 && __DEV__) {
        console.log(`[GroupChat] ⏸️ Skipping sync - ${messagesBeingSent.size} message(s) being sent`);
      }
      return;
    }

    isPollingRef.current = true;
    try {
      // Sync with server - this saves to SQLite
      const syncResult = await syncConversationMessages(Number(id), 'group', user?.id || 0);
      
      if (!syncResult.success || syncResult.newMessagesCount === 0) {
        isPollingRef.current = false;
        return;
      }

      // Load all messages from SQLite (after sync)
      const syncedMessages = await loadMessagesFromDb(100, 0); // Load enough to get new ones
      
      if (syncedMessages.length === 0) {
        isPollingRef.current = false;
        return;
      }

      // Sort messages to find the newest
      const sortedMessages = syncedMessages.sort((a: Message, b: Message) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      
      const newestMessage = sortedMessages[sortedMessages.length - 1];
      
      // Check if we have new messages (newer than our latest)
      if (newestMessage.id > latestMessageIdRef.current) {
        // Find all new messages (those with ID > latestMessageIdRef.current)
        const newMessages = sortedMessages.filter((msg: Message) => 
          msg.id > latestMessageIdRef.current!
        );
        
        if (newMessages.length > 0) {
          // Update UI with all messages from SQLite (ensures consistency)
          setMessages(prev => {
            // CRITICAL FIX: Use comprehensive duplicate check (ID + content+sender+timestamp)
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
            
            // Merge with existing messages
            const allUniqueMessages = [
              ...prev,
              ...uniqueNewMessages
            ].sort((a: Message, b: Message) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            
            // CRITICAL: Always deduplicate (defense in depth)
            const deduplicated = deduplicateMessages(allUniqueMessages);
            
            // Update latest message ID
            if (deduplicated.length > 0) {
              const latestMsg = deduplicated[deduplicated.length - 1];
              latestMessageIdRef.current = latestMsg.id;
              messagesLengthRef.current = deduplicated.length;
            }
            
            return deduplicated;
          });
          
          // Auto-scroll to bottom when receiving new messages
          // Only scroll if user is near bottom (hasn't manually scrolled up)
          // Prevent during initial load - onLayout handles initial scroll
          // Auto-scroll to bottom when receiving new messages (only if user is at bottom)
          // Position maintenance will be handled by onContentSizeChange
          if (isAtBottomRef.current && !isInitialLoadRef.current) {
            shouldMaintainPositionRef.current = true;
            // onContentSizeChange will handle the scroll adjustment
          }
          
          if (__DEV__) {
            console.log(`[GroupChat] Synced ${newMessages.length} new messages from SQLite`);
          }
        }
      }
    } catch (error: any) {
      // Silently handle errors - don't interrupt user
      // Only log in dev mode
      if (__DEV__) {
        console.log('[GroupChat] Sync error (silent):', error.message);
      }
    } finally {
      isPollingRef.current = false;
    }
  }, [id, loadingMore, sending, dbInitialized, user?.id, loadMessagesFromDb, hasScrolledToBottom, scrollToBottom, deduplicateMessages]);

  // Start/stop periodic sync based on screen focus and user activity
  useEffect(() => {
    // Don't start syncing if:
    // - User is loading more messages
    // - User is sending a message
    // - No messages loaded yet
    // - Database not initialized
    if (loadingMore || sending || messages.length === 0 || !latestMessageIdRef.current || !dbInitialized) {
      // Clear sync interval if it exists
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    // Start periodic sync (replaces polling - uses sync service + SQLite)
    pollingIntervalRef.current = setInterval(() => {
      syncForNewMessages();
    }, POLLING_INTERVAL);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [id, loadingMore, sending, dbInitialized, syncForNewMessages]); // CRITICAL FIX: Removed 'messages.length' to prevent stale closure
  
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
    isPollingRef.current = false; // Reset sync flag
    initialScrollCompleteRef.current = false; // Reset initial scroll flag
    
    // Clear sync interval
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
  
  // Cleanup retry timeout and sync interval on unmount
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

  // Mark messages as read and refresh messages when group chat is opened
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
          const markGroupMessagesAsRead = async () => {
            try {
              await groupsAPI.markMessagesAsRead(Number(id));
              updateUnreadCount(Number(id), 0);
            } catch (error) {
              // Silently ignore errors
            }
          };
          markGroupMessagesAsRead();
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
        // Reset scroll flag on focus if at bottom or initial load
        setHasScrolledToBottom(false);
        isAtBottomRef.current = true;
      } else {
        // User is viewing old messages, don't auto-scroll
        isAtBottomRef.current = false;
      }
      
      fetchMessages(!hasExistingMessages);

      const markGroupMessagesAsRead = async () => {
        if (!ENABLE_MARK_AS_READ || !id || !user) return;
        
        // CRITICAL FIX: Check network connectivity before making API call
        try {
          const netInfo = await NetInfo.fetch();
          if (!netInfo.isConnected) {
            if (__DEV__) {
              console.log('[GroupChat] Skipping mark as read - no network connection');
            }
            needsMarkAsReadRef.current = true; // Set flag to retry when network comes back
            return; // Don't make API call if offline
          }
        } catch (netError) {
          // If NetInfo fails, assume offline to be safe
          if (__DEV__) {
            console.warn('[GroupChat] Could not check network status:', netError);
          }
          needsMarkAsReadRef.current = true; // Set flag to retry when network comes back
          return;
        }
        
        try {
          // Mark all unread messages in this group as read
          await groupsAPI.markMessagesAsRead(Number(id));
          
          // Update unread count to 0 for this group
          updateUnreadCount(Number(id), 0);
          needsMarkAsReadRef.current = false; // Reset flag on success
          
          if (__DEV__) {
            console.log('Group messages marked as read');
          }
        } catch (error: any) {
          // Handle errors gracefully
          const statusCode = error?.response?.status;
          const isNetworkError = 
            error?.code === 'ERR_NETWORK' ||
            error?.message?.includes('Network Error') ||
            !error?.response;
          
          if (isNetworkError) {
            // Network error - set flag to retry when network comes back
            needsMarkAsReadRef.current = true;
            if (__DEV__) {
              console.log('[GroupChat] Mark as read failed - network error, will retry when online');
            }
          } else {
          // 429 = Too Many Requests (rate limit) - expected, handled gracefully
          // 422 = Validation error - expected in some cases
          // 404 = Not found - endpoint might not exist yet
          // Only log unexpected errors in development
          if (statusCode !== 429 && statusCode !== 422 && statusCode !== 404) {
            if (__DEV__) {
              console.error('Error marking group messages as read:', statusCode || error?.message || error);
            }
          }
          }
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
            await groupsAPI.markMessagesAsRead(Number(id));
            
            updateUnreadCount(Number(id), 0);
            needsMarkAsReadRef.current = false; // Reset flag
            
            if (__DEV__) {
              console.log('[GroupChat] Mark as read retried successfully after network reconnect');
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
              console.error('[GroupChat] Mark as read retry failed:', error);
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

  // Load more messages function
  const loadMoreMessages = async () => {
    if (loadingMore || !hasMoreMessages) return;
    
    // CRITICAL FIX: Disable auto-scroll when loading older messages
    // User wants to stay at the top viewing old messages
    isAtBottomRef.current = false;
    shouldMaintainPositionRef.current = false; // Don't maintain position when loading older messages
    isPaginatingRef.current = true; // Mark that we're paginating
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
      // Reset pagination flag after a delay to allow scroll position to stabilize
      setTimeout(() => {
        isPaginatingRef.current = false;
      }, 1000);
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
      conversation_type: 'group' as const,
      sender_id: Number(user?.id || 0),
      group_id: Number(id),
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
      group_id: Number(id),
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
      sync_status: 'pending',
      attachments: localMessage.attachments,
    };
    
    try {
      // ✅ CRITICAL FIX: Mark message as sending BEFORE saving to SQLite
      // This prevents retry service from picking it up before handleSend sends it
      console.log(`[GroupChat] 🔒 Marking message ${tempLocalId} as sending BEFORE SQLite save | Content: "${messageText?.substring(0, 50)}"`);
      markMessageAsSending(tempLocalId);
      
      // STEP 1: Save to SQLite first with pending status (instant local storage)
      let actualMessageId = tempLocalId; // Will be updated if SQLite assigns different ID
      if (dbInitialized) {
        try {
          await saveDbMessages([{
            id: tempLocalId, // ✅ CRITICAL: Provide tempLocalId so saveMessages uses it
            conversation_id: Number(id),
            conversation_type: 'group',
            sender_id: Number(user?.id || 0),
            group_id: Number(id),
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
                  console.log(`[GroupChat] ⚠️ ID MISMATCH: tempLocalId=${tempLocalId}, SQLite ID=${actualMessageId}. Updating marking.`);
                  // Update marking to use SQLite ID
                  unmarkMessageAsSending(tempLocalId);
                  markMessageAsSending(actualMessageId);
                } else {
                  console.log(`[GroupChat] ✅ Message saved with tempLocalId: ${tempLocalId}`);
                }
              }
            }
          } catch (idCheckError) {
            console.warn(`[GroupChat] Could not verify SQLite ID, using tempLocalId:`, idCheckError);
          }
          
          if (__DEV__ || process.env.EXPO_PUBLIC_DEBUG_API === 'true') {
            console.log('[GroupChat] Saved message to SQLite with pending status:', {
              tempLocalId,
              actualMessageId,
              message: messageText?.substring(0, 50),
              groupId: Number(id),
              timestamp: now,
            });
          }
        } catch (dbError: any) {
          // ✅ CRITICAL: Log detailed error information for debugging
          console.error('[GroupChat] Error saving to SQLite:', {
            error: dbError?.message || String(dbError),
            tempLocalId,
            message: messageText?.substring(0, 50),
            groupId: Number(id),
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
            console.warn('[GroupChat] Message with tempLocalId already exists, skipping:', tempLocalId);
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
            if (flatListRef.current) {
              try {
                flatListRef.current.scrollToEnd({ animated: true });
              } catch {
                // Scroll failed, will retry
              }
            }
          }, attachment || voiceRecording ? 300 : 100);
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
          // ✅ CRITICAL FIX: Message is already marked as sending (done before SQLite save)
          // No need to mark again here
          
          // Check if message already has server_id (already synced) before sending
          // This prevents duplicate sends if retry service already sent it
          if (dbInitialized) {
            try {
              const database = await getDb();
              if (database) {
                // Check both tempLocalId and actualMessageId
                const existingMessage = await database.getFirstAsync<{ server_id?: number; created_at?: string }>(
                  `SELECT server_id, created_at FROM messages WHERE id = ? OR id = ?`,
                  [tempLocalId, actualMessageId]
                );
                
                if (existingMessage?.server_id) {
                  if (__DEV__) {
                    console.log(`[GroupChat] Message ${actualMessageId} (tempLocalId: ${tempLocalId}) already has server_id ${existingMessage.server_id}, skipping API call`);
                  }
                  // Update UI with server ID and server timestamp, but first check for duplicates
                  setMessages(prev => {
                    const serverId = existingMessage.server_id!;
                    const serverCreatedAt = existingMessage.created_at;
                    // Check if there's already a message with this server ID (from sync)
                    const existingServerMessage = prev.find(msg => msg.id === serverId);
                    
                    let updatedMessages;
                    if (existingServerMessage) {
                      // Remove the temp message and keep the server one (which is more complete)
                      updatedMessages = prev.filter(msg => msg.id !== tempLocalId && msg.id !== actualMessageId);
                    } else {
                      // Update temp message to server ID AND update timestamp to match server
                      updatedMessages = prev.map(msg => 
                        (msg.id === tempLocalId || msg.id === actualMessageId)
                          ? { 
                              ...msg, 
                              id: serverId, 
                              sync_status: 'synced',
                              created_at: serverCreatedAt || msg.created_at // Use server timestamp from DB
                            }
                          : msg
                      );
                    }
                    // Ensure no duplicates remain
                    return deduplicateMessages(updatedMessages);
                  });
                  unmarkMessageAsSending(tempLocalId);
                  unmarkMessageAsSending(actualMessageId); // ✅ Unmark before returning
                  return; // Don't send again
                }
              }
            } catch (checkError) {
              // Continue with send if check fails
              if (__DEV__) {
                console.warn('[GroupChat] Error checking message status:', checkError);
              }
            }
          }
          
          let formData = new FormData();
      formData.append('group_id', id as string);
      
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
              console.warn(`[GroupChat] ⚠️ Message ${actualMessageId} (tempLocalId: ${tempLocalId}) was unmarked before send - marking again`);
              markMessageAsSending(actualMessageId);
            }
            
            // ✅ LOGGING: Log API send attempt
            const sendStartTime = Date.now();
            console.log(`[GroupChat] 📤 SENDING message ${actualMessageId} (tempLocalId: ${tempLocalId}) to API | Content: "${messageText?.substring(0, 50)}" | Marked as sending: ${isMarked}`);
            
            // Send to API (single attempt - no retries)
            const res = await messagesAPI.sendMessage(formData);
            
            const sendDuration = Date.now() - sendStartTime;
            console.log(`[GroupChat] 📥 API RESPONSE for message ${actualMessageId} (tempLocalId: ${tempLocalId}) | Status: ${res.status} | Duration: ${sendDuration}ms`);
            
            // Check if status indicates success
            if (res.status >= 200 && res.status < 300) {
              console.log(`[GroupChat] ✅ API SEND SUCCESS for message ${actualMessageId} (tempLocalId: ${tempLocalId}) | Status: ${res.status}`);
              
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
                console.log(`[GroupChat] 📋 Extracted server_id ${messageId} from API response for message ${actualMessageId} (tempLocalId: ${tempLocalId})`);
              } else {
                console.warn(`[GroupChat] ⚠️ No messageId found in API response for message ${actualMessageId} | Response structure:`, JSON.stringify(res.data).substring(0, 200));
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
                  console.log(`[GroupChat] 💾 Updating message ${messageIdToUpdate} (tempLocalId: ${tempLocalId}) status to synced with server_id ${messageId}`);
                  const updateStartTime = Date.now();
                  
                  const updateSucceeded = await updateMessageStatus(messageIdToUpdate, messageId, 'synced', serverCreatedAt);
                  const updateDuration = Date.now() - updateStartTime;
                  
                  if (updateSucceeded) {
                    console.log(`[GroupChat] ✅ DATABASE UPDATE SUCCESS for message ${messageIdToUpdate} | server_id: ${messageId} | Duration: ${updateDuration}ms`);
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
                        console.log(`[GroupChat] 🔄 Server ID ${messageId} already exists in UI, removing tempLocalId ${tempLocalId} and actualMessageId ${actualMessageId}`);
                        const filtered = prev.filter(msg => 
                          msg.id !== tempLocalId && msg.id !== actualMessageId
                        );
                        return deduplicateMessages(filtered);
                      } else if (messageToUpdate) {
                        // Update tempLocalId/actualMessageId to server ID
                        console.log(`[GroupChat] 🔄 Updating message ${tempLocalId}/${actualMessageId} to server_id ${messageId}`);
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
                        console.log(`[GroupChat] ⚠️ Message ${tempLocalId}/${actualMessageId} not found in UI, adding with server_id ${messageId}`);
                        const newMessage: Message = {
                          id: messageId,
                          message: messageText || null,
                          sender_id: Number(user?.id || 0),
                          group_id: Number(id),
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
                    console.warn(`[GroupChat] ⚠️ Failed to update message ${tempLocalId} status - will be retried by retry service`);
                  }
                  
                  // ✅ CRITICAL FIX: Only unmark AFTER updateMessageStatus completes
                  // This prevents retry service from picking it up before status is updated
                  unmarkMessageAsSending(tempLocalId);
                } catch (updateError) {
                  console.error('[GroupChat] Error updating message status:', updateError);
                  // ✅ Unmark even on error so retry service can handle it
                  unmarkMessageAsSending(tempLocalId);
                }
              } else {
                // No messageId in response - leave as pending, retry service will verify and update
                // ✅ CRITICAL FIX: Keep marked as sending until retry service handles it
                // Don't unmark here - let retry service unmark after it verifies/updates
                // Actually, we should unmark here since we're not updating status
                unmarkMessageAsSending(tempLocalId);
              }
            } else {
              // Non-success status - leave as pending, retry service will retry
              unmarkMessageAsSending(tempLocalId); // ✅ Unmark so retry service can retry
            }
          } catch (apiError: any) {
            // Check if it's a client error (4xx) - mark as failed
            const isClientError = apiError.response?.status >= 400 && apiError.response?.status < 500;
            
            if (isClientError) {
              // Client error (4xx) - mark as failed immediately
              if (dbInitialized) {
                await updateMessageStatus(tempLocalId, undefined, 'failed');
                setMessages(prev => prev.map(msg => 
                  msg.id === tempLocalId 
                    ? { ...msg, sync_status: 'failed' }
                    : msg
                ));
              }
              unmarkMessageAsSending(tempLocalId); // ✅ Unmark
            } else {
              // Network error or other - leave as pending, retry service will retry
              unmarkMessageAsSending(tempLocalId); // ✅ Unmark so retry service can retry
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
          console.error('[GroupChat] Unexpected error in handleSend:', error);
          
          // Ensure message is kept as pending for retry
          if (dbInitialized) {
            await updateMessageStatus(tempLocalId, undefined, 'pending');
            setMessages(prev => prev.map(msg => 
              msg.id === tempLocalId 
                ? { ...msg, sync_status: 'pending' }
                : msg
            ));
          }
          unmarkMessageAsSending(tempLocalId); // ✅ Unmark so retry service can pick it up
        }
      })();
      
    } catch (e: unknown) {
      const error = e as any;
      console.error('[GroupChat] Error in handleSend:', error);
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
            console.log('[GroupChat] Updated edited message in SQLite:', editingMessage.id);
          }
        } catch (dbError) {
          console.error('[GroupChat] Error updating SQLite after edit:', dbError);
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
              await messagesAPI.deleteMessage(messageId);
              
              // Remove message from local state
              setMessages(prev => prev.filter(msg => msg.id !== messageId));
              
              // Delete from SQLite immediately
              if (dbInitialized) {
                try {
                  await deleteDbMessage(messageId);
                  if (__DEV__) {
                    console.log('[GroupChat] Deleted message from SQLite:', messageId);
                  }
                } catch (dbError) {
                  console.error('[GroupChat] Error deleting from SQLite:', dbError);
                  // Continue anyway - sync will fix it later
                }
              }
              
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
                  [{ text: 'OK', onPress: async () => {
                    // Remove from local state anyway
                    setMessages(prev => prev.filter(msg => msg.id !== messageId));
                    
                    // Also try to delete from SQLite
                    if (dbInitialized) {
                      try {
                        await deleteDbMessage(messageId);
                      } catch (dbError) {
                        console.error('[GroupChat] Error deleting from SQLite (404 case):', dbError);
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
    const isLastMessage = index === messages.length - 1; // Track if this is the last message
    
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
                    {item.edited_at && ' • Edited'}
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
            readAt={item.read_at}
            syncStatus={item.sync_status || 'pending'}
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
                }}>
                  {timestamp}
                  {item.edited_at && ' • Edited'}
                </Text>
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
                }}>
                  {timestamp}
                  {item.edited_at && ' • Edited'}
                </Text>
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
                
                {/* Timestamp inside bubble at bottom right */}
                <View style={{ width: '100%', flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
                  <Text style={{ 
                    fontSize: 10, 
                    color: isMine ? '#E0E7FF' : '#6B7280',
                    marginRight: 0,
                  }}>
                    {timestamp}
                    {item.edited_at && ' • Edited'}
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
                      }}>
                        {timestamp}
                        {item.edited_at && ' • Edited'}
                      </Text>
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
                          }}>
                            {timestamp}
                            {item.edited_at && ' • Edited'}
                          </Text>
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
  const handleEmojiSelect = (emoji: any) => {
    setInput(input + emoji.native);
    setShowEmoji(false);
  };

  // Removed duplicate fetchMessages call - useFocusEffect handles fetching to prevent duplicate loads

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
              initialNumToRender={30}
              windowSize={10}
              maxToRenderPerBatch={15}
              removeClippedSubviews={true}
              updateCellsBatchingPeriod={50}
              // REMOVED: onEndReached - it fires at bottom (newest messages) but we want to load at top (oldest)
              // Loading more messages is handled by onScroll handler when user scrolls to top
              extraData={messages.length} // Force re-render when messages array changes
                keyExtractor={(item, index) => {
                  // Create a unique key that handles temporary IDs and prevents duplicates
                  // Always include index as a fallback to ensure uniqueness even with duplicate IDs
                  if (item && item.id !== undefined && item.id !== null && item.id !== 0) {
                    // For pending messages (temp IDs), include sync_status to ensure uniqueness
                    // This prevents duplicate keys when a temp message gets updated to server ID
                    if (item.sync_status === 'pending') {
                      // Use a combination that includes created_at for pending messages
                      // This ensures temp messages have unique keys even if they share the same ID pattern
                      const createdAt = item.created_at || index.toString();
                      return `message-pending-${item.id}-${createdAt}-${index}`;
                    }
                    // For synced messages, include index to ensure uniqueness even if duplicate IDs exist
                    // This prevents React key warnings when deduplication hasn't run yet
                    const createdAt = item.created_at ? `-${item.created_at}` : '';
                    return `message-${item.id}${createdAt}-${index}`;
                  }
                  // For messages without IDs, use index and created_at if available
                  const fallbackKey = item?.created_at 
                    ? `message-fallback-${index}-${item.created_at}` 
                    : `message-fallback-${index}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                  return fallbackKey;
                }}
                contentContainerStyle={{ 
                  padding: 16, 
                  paddingBottom: 0, // Let KeyboardAvoidingView handle spacing
                }}
                inverted={false} // Normal scrolling - scroll down to see older messages
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
                
                // Update anchor message and position maintenance flag when user is at bottom
                if (isAtBottom && messages.length > 0) {
                  isAtBottomRef.current = true;
                  shouldMaintainPositionRef.current = true;
                  lastVisibleMessageIdRef.current = messages[messages.length - 1].id;
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
                // Maintain fixed position of last message when content changes (polling, refetch, image loading)
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
                
                // Initial scroll to bottom on first load - scroll to show latest message at bottom
                if (isInitialLoadRef.current && !loading && messages.length > 0 && !initialScrollCompleteRef.current) {
                  setTimeout(() => {
                    if (flatListRef.current && messages.length > 0) {
                      try {
                        // Scroll to end to show latest message at bottom (before input)
                        flatListRef.current.scrollToEnd({ animated: false });
                        
                        initialScrollCompleteRef.current = true;
                        isInitialLoadRef.current = false;
                        setHasScrolledToBottom(true);
                        isAtBottomRef.current = true;
                        shouldMaintainPositionRef.current = true;
                        if (messages.length > 0) {
                          lastVisibleMessageIdRef.current = messages[messages.length - 1].id;
                        }
                      } catch (error) {
                        // Mark as complete even if scroll fails
                        initialScrollCompleteRef.current = true;
                        isInitialLoadRef.current = false;
                      }
                    }
                  }, 100);
                }
              }}
              onLayout={(event) => {
                // Track viewport height when layout changes
                const { height } = event.nativeEvent.layout;
                viewportHeightRef.current = height;
              }}
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

                {/* Gallery Button - Hide when editing */}
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