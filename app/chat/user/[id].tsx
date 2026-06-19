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
import { deleteMessage as deleteDbMessage, initDatabase, updateMessageByServerId } from '@/services/database';
import { retryFailedMessage as retryFailedMessageViaOutbox } from '@/services/messageRetryService';
import { enqueueOutgoingMessage } from '@/services/outboxService';
import {
  buildOutboxPayload,
  loadMessagesFromCache,
  mapApiMessages,
  mergeMessagesWithPending,
  mergeDeltaMessages,
  persistApiMessages,
  persistOutgoingMessage,
  MESSAGES_PER_PAGE,
  DELTA_POLL_INTERVAL_MS,
  useOutboxSync,
  deduplicateMessages,
} from '@/hooks/useChatMessages';
import { generateClientMessageId } from '@/utils/clientMessageId';
import { getCachedAuthUserId } from '@/utils/cachedAuthUser';
import { isLocalPending } from '@/utils/messageIdentity';
import {
  isOwnDirectMessage,
  parseVoiceMessage,
  resolveMediaUrl,
} from '@/utils/chatMessageOwnership';
import { markUserChatAsRead } from '@/services/markReadService';
import { subscribeConversationChannel, onRealtimeMessage, handleRealtimeMessage, isRealtimeConnected } from '@/services/realtimeService';
import { syncOlderMessages } from '@/services/syncService';
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
import { ActivityIndicator, Alert, AppState, BackHandler, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, StatusBar, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const options = ({ params }: { params: any }) => ({
  headerShown: false, // Hide the default header, use custom header instead
});

interface Message {
  id: number;
  server_id?: number;
  client_message_id?: string | null;
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
  const ENABLE_CHAT_DEBUG_LOGS = __DEV__ && process.env.EXPO_PUBLIC_DEBUG_CHAT === 'true';
  const [messages, setMessages] = useState<Message[]>([]);
  useOutboxSync(setMessages);

  // Inverted FlatList data: newest first (index 0 = newest, renders at visual bottom)
  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);
  
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
  const POLLING_INTERVAL = DELTA_POLL_INTERVAL_MS;
  const MAX_RETRY_ATTEMPTS = 5; // Maximum retry attempts
  const INITIAL_RETRY_DELAY = 1000; // Start with 1 second delay
  
  const isAtBottomRef = useRef<boolean>(true); // Inverted list: offset ~0 = at newest
  const needsMarkAsReadRef = useRef<boolean>(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dbInitialized, setDbInitialized] = useState(false);
  const [loadedMessagesCount, setLoadedMessagesCount] = useState(0);

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

  const loadMessagesFromDb = useCallback(async (limit: number = MESSAGES_PER_PAGE): Promise<Message[]> => {
    if (!dbInitialized) return [];
    try {
      return (await loadMessagesFromCache(Number(id), 'individual', limit)) as Message[];
    } catch (error) {
      console.error('[UserChat] Error loading messages from database:', error);
      return [];
    }
  }, [id, dbInitialized]);

  // Cache-first: SQLite immediately, then API merge (stale-while-revalidate)
  const fetchMessages = useCallback(async (showLoading = true) => {
    // Show loading spinner if requested
    if (showLoading) {
      setLoading(true);
    }

    if (dbInitialized) {
      try {
        const cached = await loadMessagesFromDb(MESSAGES_PER_PAGE);
        if (cached.length > 0) {
          setMessages(cached);
          messagesLengthRef.current = cached.length;
          setLoadedMessagesCount(cached.length);
          latestMessageIdRef.current = cached[cached.length - 1].id;
          if (showLoading) {
            setLoading(false);
          }
        }
      } catch (cacheError) {
        console.error('[UserChat] Cache-first load failed:', cacheError);
      }
    }
    
    // Background API fetch (source of truth)
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
      
      apiMessages = mapApiMessages(processedMessages) as Message[];
      apiSuccess = true;

      const partnerId = Number(id);
      const authUserId = Number(user?.id ?? 0);
      apiMessages = apiMessages.map((msg) => {
        const enriched = { ...msg };
        if (!enriched.sender && partnerId > 0 && Number(enriched.sender_id) === partnerId) {
          enriched.sender = {
            id: partnerId,
            name: res.data.selectedConversation?.name ?? userInfo?.name ?? 'User',
            avatar_url:
              res.data.selectedConversation?.avatar_url ??
              userInfo?.avatar_url ??
              userInfo?.user?.avatar_url,
          };
        } else if (!enriched.sender && authUserId > 0 && Number(enriched.sender_id) === authUserId) {
          enriched.sender = {
            id: authUserId,
            name: user?.name ?? 'You',
            avatar_url: user?.avatar_url,
          };
        }
        return enriched;
      });
      
      if (dbInitialized) {
        try {
          await persistApiMessages(Number(id), 'individual', apiMessages);
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
      setMessages(prev => {
        const merged = mergeMessagesWithPending(apiMessages, prev) as Message[];
        messagesLengthRef.current = merged.length;
        if (merged.length > 0) {
          latestMessageIdRef.current = merged[merged.length - 1].id;
        }
        return merged;
      });
      
      setLoadedMessagesCount(messagesLengthRef.current);
      
      if (showLoading) {
        setLoading(false);
      }
    } else {
      // ❌ API failed - fallback to SQLite
      if (dbInitialized) {
        try {
          const sqliteMessages = await loadMessagesFromDb(MESSAGES_PER_PAGE);
          
          if (sqliteMessages.length > 0) {
            setMessages(sqliteMessages);
            messagesLengthRef.current = sqliteMessages.length;
            setLoadedMessagesCount(sqliteMessages.length);
            
            if (sqliteMessages.length > 0) {
              const latestMsg = sqliteMessages[sqliteMessages.length - 1];
              latestMessageIdRef.current = latestMsg.id;
            }
            
            if (showLoading) {
              setLoading(false);
            }
          } else {
            // Keep current messages on transient API/SQLite failures.
            // Only show empty state if there are truly no messages in memory.
            if (messagesLengthRef.current === 0) {
              setMessages([]);
              messagesLengthRef.current = 0;
              setLoadedMessagesCount(0);
            }
            
            if (showLoading) {
              setLoading(false);
            }
          }
        } catch (sqliteError) {
          console.error('[UserChat] Error loading from SQLite fallback:', sqliteError);
          // Keep the last rendered messages on fallback errors.
          if (messagesLengthRef.current === 0) {
            setMessages([]);
            messagesLengthRef.current = 0;
          }
          
          if (showLoading) {
            setLoading(false);
          }
        }
      } else {
        // Keep last rendered messages if available while backend is unavailable.
        if (messagesLengthRef.current === 0) {
          setMessages([]);
          messagesLengthRef.current = 0;
        }
        
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
    }, [id, updateUnreadCount, user?.id, user?.name, user?.avatar_url]);

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
    if (
      AppState.currentState !== 'active' ||
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
      const latestId = latestMessageIdRef.current;
      const res = await messagesAPI.getByUserSince(Number(id), undefined, latestId);
      const messagesData = res.data.messages?.data || res.data.messages || res.data || [];
      if (!Array.isArray(messagesData) || messagesData.length === 0) return;

      const delta = mapApiMessages(messagesData) as Message[];
      const newOnly = delta.filter((msg) => msg.id > latestId);
      if (newOnly.length === 0) return;

      if (dbInitialized) {
        await persistApiMessages(Number(id), 'individual', newOnly);
      }

      setMessages((prev) => mergeDeltaMessages(prev as Message[], newOnly) as Message[]);
      latestMessageIdRef.current = newOnly[newOnly.length - 1].id;

      if (isAtBottomRef.current) {
        requestAnimationFrame(() => {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
        });
      }
    } catch (error) {
      if (__DEV__) {
        console.log('[UserChat] Polling error (silent):', (error as Error)?.message);
      }
    } finally {
      isPollingRef.current = false;
    }
  }, [id, loadingMore, sending, dbInitialized]);

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
      if (isRealtimeConnected()) return;
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
  
  // ✅ NEW: Retry service removed - users can manually retry failed messages from UI
  
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

  // Phase 1: outbox sync handled by useOutboxSync(setMessages)

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

  const scrollToBottom = useCallback((animated = false) => {
    // Inverted list: newest message lives at offset 0 (visual bottom)
    if (!flatListRef.current || messages.length === 0) return;
    flatListRef.current.scrollToOffset({ offset: 0, animated });
  }, [messages.length]);

  const applyLocalReadState = useCallback(() => {
    if (!id || !user) return;
    updateUnreadCount(Number(id), 0);
    setMessages(prevMessages => {
      const now = new Date().toISOString();
      return prevMessages.map(msg => {
        if (msg.sender_id === Number(id) && msg.receiver_id === user.id && !msg.read_at) {
          return { ...msg, read_at: now };
        }
        return msg;
      });
    });
  }, [id, user, updateUnreadCount]);

  const markConversationAsRead = useCallback(async () => {
    if (!ENABLE_MARK_AS_READ || !id || !user) return;

    applyLocalReadState();

    try {
      const netInfo = await NetInfo.fetch();
      if (!netInfo.isConnected) {
        needsMarkAsReadRef.current = true;
        return;
      }
    } catch {
      needsMarkAsReadRef.current = true;
      return;
    }

    try {
      const result = await markUserChatAsRead(Number(id));
      needsMarkAsReadRef.current = !result.ok && !result.skipped && !result.rateLimited;
    } catch (error: any) {
      const isNetworkError =
        error?.code === 'ERR_NETWORK' ||
        error?.message?.includes('Network Error') ||
        !error?.response;

      if (isNetworkError) {
        needsMarkAsReadRef.current = true;
      } else if (__DEV__ && error?.response?.status !== 429) {
        console.log('[UserChat] mark as read failed:', error?.response?.status || error?.message);
      }
    }
  }, [ENABLE_MARK_AS_READ, id, user, applyLocalReadState]);

  const fetchMessagesRef = useRef(fetchMessages);
  const markConversationAsReadRef = useRef(markConversationAsRead);
  const loadingMoreRef = useRef(loadingMore);
  const sendingRef = useRef(sending);
  const currentPageRef = useRef(currentPage);
  const setActiveConversationRef = useRef(setActiveConversation);
  const clearActiveConversationRef = useRef(clearActiveConversation);
  fetchMessagesRef.current = fetchMessages;
  markConversationAsReadRef.current = markConversationAsRead;
  loadingMoreRef.current = loadingMore;
  sendingRef.current = sending;
  currentPageRef.current = currentPage;
  setActiveConversationRef.current = setActiveConversation;
  clearActiveConversationRef.current = clearActiveConversation;

  useEffect(() => {
    const conversationId = Number(id);
    if (!conversationId) return;

    // The backend broadcasts each DM to both the sender and receiver id
    // channels, and channel auth only permits listening on your *own* id.
    // So subscribe to our own private channel, not the other user's id.
    let unsubChannel = () => {};
    let cancelled = false;

    void (async () => {
      const myUserId =
        Number(user?.id ?? 0) || Number(await getCachedAuthUserId()) || 0;
      if (cancelled || !myUserId) return;
      unsubChannel = subscribeConversationChannel({
        conversationId: myUserId,
        conversationType: 'individual',
      });
    })();

    const unsubHandler = onRealtimeMessage((message) => {
      const isForThisChat =
        message.group_id == null &&
        (message.sender_id === conversationId || message.receiver_id === conversationId);
      if (!isForThisChat) return;

      void handleRealtimeMessage(conversationId, 'individual', message, (applyMerge) => {
        setMessages((prev) => applyMerge(prev as Message[]) as Message[]);
      });

      if (message.id > (latestMessageIdRef.current ?? 0)) {
        latestMessageIdRef.current = message.id;
      }

      if (isAtBottomRef.current) {
        requestAnimationFrame(() => {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
        });
      }
    });

    return () => {
      cancelled = true;
      unsubChannel();
      unsubHandler();
    };
  }, [id, user?.id]);

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

  // Mark messages as read and refresh messages when conversation is opened
  useFocusEffect(
    useCallback(() => {
      const conversationId = Number(id);
      if (conversationId) {
        setActiveConversationRef.current(conversationId);
      }

      const now = Date.now();
      const timeSinceLastFocus = now - lastFocusTimeRef.current;
      lastFocusTimeRef.current = now;

      const shouldSkipRefresh =
        loadingMoreRef.current ||
        isPaginatingRef.current ||
        currentPageRef.current > 1 ||
        sendingRef.current ||
        (timeSinceLastFocus < 2000 && messagesLengthRef.current > 0);

      if (shouldSkipRefresh) {
        void markConversationAsReadRef.current();
        return () => {
          clearActiveConversationRef.current();
        };
      }

      const hasExistingMessages = messagesLengthRef.current > 0;

      if (!hasExistingMessages) {
        isAtBottomRef.current = true;
      }

      void fetchMessagesRef.current(!hasExistingMessages);
      void markConversationAsReadRef.current();

      return () => {
        clearActiveConversationRef.current();
      };
    }, [id])
  );

  // Inverted list rests at the newest message automatically — no manual initial scroll needed.

  // CRITICAL FIX: Network listener to retry mark-read when network comes back
  useEffect(() => {
    if (!ENABLE_MARK_AS_READ || !id || !user) return;
    
    // Set up network listener
    const unsubscribe = NetInfo.addEventListener(state => {
      const isConnected = state.isConnected ?? false;
      
      if (isConnected && needsMarkAsReadRef.current) {
        setTimeout(() => markConversationAsRead(), 500);
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, [id, user, ENABLE_MARK_AS_READ, markConversationAsRead]);

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
          const cachedMessages = await loadMessagesFromDb(MESSAGES_PER_PAGE);
          
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

  const handleSend = async () => {
    // Don't send if there's no content at all
    if (!input.trim() && !attachment && !voiceRecording) return;
    
    // Prevent multiple simultaneous sends
    if (sending) {
      console.warn('Message send already in progress, ignoring duplicate send');
      return;
    }

    let senderId = Number(user?.id || 0);
    if (!senderId) {
      const cachedId = await getCachedAuthUserId();
      if (cachedId) senderId = cachedId;
    }
    if (!senderId) {
      Alert.alert('Error', 'Unable to verify your account. Please log in again.');
      return;
    }
    
    setSending(true);
    const logSend = (...args: unknown[]) => {
      if (ENABLE_CHAT_DEBUG_LOGS) console.log(...args);
    };
      
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
    
    const clientMessageId = generateClientMessageId();
    const now = new Date().toISOString();
    const attachmentSnapshot = attachment;
    const voiceSnapshot = voiceRecording;
    const replySnapshot = replyingTo;

    const localAttachments = attachment ? [{
      name: attachment.name || 'attachment',
      mime: attachment.type || 'application/octet-stream',
      url: attachment.uri,
      local_path: attachment.uri,
    }] : voiceRecording ? [{
      name: 'voice_message.m4a',
      mime: 'audio/m4a',
      url: voiceRecording.uri,
      local_path: voiceRecording.uri,
    }] : undefined;

    const outboxPayload = buildOutboxPayload({
      messageText: messageText || null,
      receiverId: Number(id),
      replyToId: replySnapshot?.id ?? null,
      attachment: attachmentSnapshot,
      voiceRecording: voiceSnapshot,
    });

    const uiMessage: Message = {
      id: 0,
      client_message_id: clientMessageId,
      sender_id: senderId,
      receiver_id: Number(id),
      message: messageText || '',
      created_at: now,
      read_at: null,
      edited_at: null,
      reply_to: replySnapshot || undefined,
      sender: {
        id: senderId,
        name: user?.name || 'You',
        avatar_url: user?.avatar_url,
      },
      sync_status: 'pending',
      attachments: localAttachments?.map((att, idx) => ({
        id: idx,
        name: att.name,
        mime: att.mime,
        url: att.url,
      })),
    };

  try {
      let localMessageId: number | null = null;
      if (dbInitialized) {
        try {
          const saved = await persistOutgoingMessage(Number(id), 'individual', {
            client_message_id: clientMessageId,
            sender_id: senderId,
            receiver_id: Number(id),
            message: messageText || null,
            created_at: now,
            reply_to_id: replySnapshot?.id ?? null,
            attachments: localAttachments as any,
          });
          if (saved[0]?.localMessageId) {
            localMessageId = saved[0].localMessageId;
            uiMessage.id = localMessageId;
          }
        } catch (dbError) {
          console.error('[UserChat] Error saving to SQLite:', dbError);
        }
      }

      await enqueueOutgoingMessage({
        clientMessageId,
        localMessageId,
        conversationId: Number(id),
        conversationType: 'individual',
        payload: outboxPayload,
      });

      setMessages(prev => deduplicateMessages([...prev, uiMessage].sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )));
      
      setInput('');
      setAttachment(null);
      setVoiceRecording(null);
      setReplyingTo(null);
      setShowEmoji(false);
      setSending(false);
      
      Keyboard.dismiss();
      isAtBottomRef.current = true;
      requestAnimationFrame(() => {
        setTimeout(() => scrollToBottom(true), attachment || voiceRecording ? 200 : 50);
      });

      usersAPI.updateLastSeen().catch(() => {});
      
    } catch (e: unknown) {
      const error = e as any;
      console.error('[UserChat] Error in handleSend:', error?.message ?? error);
      setSending(false);
      
      Alert.alert(
        'Error',
        error?.message?.includes('runAsync')
          ? 'Could not save message locally. Please restart the app and try again.'
          : 'Failed to save message. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const retryFailedMessage = async (messageId: number) => {
    const message = messages.find((m) => m.id === messageId);
    if (!message || message.sync_status !== 'failed') return;
    setMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, sync_status: 'pending' } : msg))
    );
    await retryFailedMessageViaOutbox(messageId);
  };

  // ✅ NEW: Dismiss a failed message (remove it)
  const dismissFailedMessage = async (messageId: number) => {
    try {
      if (ENABLE_CHAT_DEBUG_LOGS) {
        console.log(`[UserChat] 🗑️ Dismissing failed message ${messageId}`);
      }
      
      if (dbInitialized) {
        await deleteDbMessage(messageId);
      }
      
      setMessages(prev => prev.filter(msg => msg.id !== messageId));
    } catch (error) {
      console.error('[UserChat] Error dismissing failed message:', error);
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
    const partnerId = Number(id);
    const isMine = isOwnDirectMessage(item, partnerId, user?.id);
    // Inverted data: the chronologically older message sits at index + 1
    const previousMessage = index < invertedMessages.length - 1 ? invertedMessages[index + 1] : null;
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

    // Check if this is a voice message (marker and/or audio attachment)
    let voiceMessageData: {
      url: string | null;
      duration: number;
      textPart?: string;
    } | null = null;
    let isVoiceMessage = false;
    let messageText: string | null = null;

    const cleanMessageText = (text: string | null | undefined): string | null => {
      if (!text) return null;
      let cleaned = text.replace(/\s*\[IMAGE\]$/g, '').replace(/\s*\[FILE\]$/g, '').trim();
      return cleaned || (text.trim() ? text.trim() : null);
    };

    const parsedVoice = parseVoiceMessage(item.message, item.attachments);
    if (parsedVoice) {
      isVoiceMessage = true;
      const audioAttachment = parsedVoice.audioAttachment;
      voiceMessageData = {
        url: resolveMediaUrl(
          audioAttachment?.url ?? audioAttachment?.path ?? audioAttachment?.uri ?? null,
          getBaseUrl
        ),
        duration: parsedVoice.duration,
        textPart: parsedVoice.textPart,
      };
    } else if (item.attachments && item.attachments.length > 0) {
      if (item.message) {
        const trimmedMessage = item.message.trim();
        if (trimmedMessage === '[IMAGE]' || trimmedMessage === '[FILE]') {
          messageText = null;
        } else {
          messageText = cleanMessageText(item.message);
        }
      } else {
        messageText = null;
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
        <View>
          {showDateSeparator && (
            <View style={{ alignItems: 'center', marginVertical: 16, marginHorizontal: 16 }}>
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
            justifyContent: isMine ? 'flex-end' : 'flex-start',
          }}>
            <TouchableOpacity
              onLongPress={() => handleMessageLongPress(item)}
              activeOpacity={0.8}
              style={{ maxWidth: '85%' }}
            >
              <VoiceMessageBubble
                uri={voiceMessageData.url}
                duration={voiceMessageData.duration}
                isMine={isMine}
                timestamp={timestamp}
                textPart={voiceMessageData.textPart}
                readAt={item.read_at}
                syncStatus={item.sync_status || 'pending'}
                embedded
              />
            </TouchableOpacity>
          </View>

          {isMine && item.sync_status === 'failed' && (
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'flex-end',
              marginTop: 8,
              gap: 8,
              paddingHorizontal: 12,
            }}>
              <Text style={{
                fontSize: 11,
                color: '#FFE5E5',
                marginRight: 'auto',
              }}>
                Failed to send
              </Text>
              <TouchableOpacity
                onPress={() => retryFailedMessage(item.id)}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 12,
                }}
              >
                <Text style={{
                  fontSize: 12,
                  color: '#fff',
                  fontWeight: '600',
                }}>
                  Retry
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => dismissFailedMessage(item.id)}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 12,
                }}
              >
                <Text style={{
                  fontSize: 12,
                  color: '#FFE5E5',
                  fontWeight: '500',
                }}>
                  Dismiss
                </Text>
              </TouchableOpacity>
            </View>
          )}
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
              maxWidth: '85%',
              minWidth: 120,
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
            ) : (firstAttachment.mime?.startsWith('audio/') || firstAttachment.type?.startsWith('audio/') ||
                /\.(m4a|mp3|wav|ogg|aac|amr|caf)$/i.test(firstAttachment.name || '')) ? (
              <VoiceMessageBubble
                uri={resolveMediaUrl(
                  firstAttachment.url || firstAttachment.path || firstAttachment.uri,
                  getBaseUrl
                )}
                duration={parseVoiceMessage(item.message, item.attachments)?.duration ?? 0}
                isMine={isMine}
                timestamp={timestamp}
                readAt={item.read_at}
                syncStatus={item.sync_status || 'synced'}
                embedded
              />
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
            
            {/* ✅ NEW: Retry/Dismiss buttons for failed messages */}
            {isMine && item.sync_status === 'failed' && (
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'flex-end',
                marginTop: 8,
                gap: 8,
                paddingTop: 8,
                borderTopWidth: 1,
                borderTopColor: isMine ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
              }}>
                <Text style={{
                  fontSize: 11,
                  color: isMine ? '#FFE5E5' : '#DC2626',
                  marginRight: 'auto',
                }}>
                  Failed to send
                </Text>
                <TouchableOpacity
                  onPress={() => retryFailedMessage(item.id)}
                  style={{
                    backgroundColor: isMine ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 12,
                  }}
                >
                  <Text style={{
                    fontSize: 12,
                    color: isMine ? '#fff' : (isDark ? '#fff' : '#111827'),
                    fontWeight: '600',
                  }}>
                    Retry
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => dismissFailedMessage(item.id)}
                  style={{
                    backgroundColor: isMine ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 12,
                  }}
                >
                  <Text style={{
                    fontSize: 12,
                    color: isMine ? '#FFE5E5' : '#9CA3AF',
                    fontWeight: '500',
                  }}>
                    Dismiss
                  </Text>
                </TouchableOpacity>
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
              data={invertedMessages}
              renderItem={renderItem}
              extraData={messages.length}
              inverted
              initialNumToRender={25}
              windowSize={10}
              maxToRenderPerBatch={15}
              removeClippedSubviews={false}
              updateCellsBatchingPeriod={50}
              keyExtractor={(item, index) => {
                if (item && item.id !== undefined && item.id !== null && item.id !== 0) {
                  const createdAt = item.created_at ? `-${item.created_at}` : '';
                  return `message-${item.id}${createdAt}-${index}`;
                }
                const fallbackKey = item?.created_at
                  ? `message-fallback-${index}-${item.sender_id || 'unknown'}-${item.created_at}`
                  : `message-fallback-${index}-${item.sender_id || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                return fallbackKey;
              }}
              style={{ flex: 1 }}
              contentContainerStyle={{
                flexGrow: 1,
                padding: 16,
              }}
              keyboardShouldPersistTaps="handled"
              onScrollToIndexFailed={(info) => {
                flatListRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: false,
                });
              }}
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              onScroll={({ nativeEvent }) => {
                isAtBottomRef.current = nativeEvent.contentOffset.y <= 80;
              }}
              scrollEventThrottle={16}
              onEndReached={() => {
                if (hasMoreMessages && !loadingMore) {
                  loadMoreMessages();
                }
              }}
              onEndReachedThreshold={0.4}
              ListFooterComponent={() =>
                loadingMore ? (
                  <View style={{ padding: 20, alignItems: 'center', transform: [{ scaleY: -1 }] }}>
                    <ActivityIndicator size="small" color="#283891" />
                    <Text style={{ color: isDark ? '#9CA3AF' : '#6B7280', marginTop: 8 }}>
                      Loading more messages...
                    </Text>
                  </View>
                ) : null
              }
              ListEmptyComponent={() => (
                <View style={{
                  flex: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingVertical: 40,
                  transform: [{ scaleY: -1 }],
                }}>
                  <Text style={{
                    color: isDark ? '#9CA3AF' : '#6B7280',
                    fontSize: 16,
                    textAlign: 'center',
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