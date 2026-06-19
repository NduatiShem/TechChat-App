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
import { markGroupChatAsRead } from '@/services/markReadService';
import { subscribeConversationChannel, onRealtimeMessage, handleRealtimeMessage, isRealtimeConnected } from '@/services/realtimeService';
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
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
  server_id?: number;
  client_message_id?: string | null;
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
  useOutboxSync(setMessages);

  // Inverted FlatList data: newest first (index 0 = newest, renders at visual bottom)
  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

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


  const flatListRef = useRef<FlatList>(null);
  
  // Background retry state - track retry attempts and timeout
  const retryAttemptRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messagesLengthRef = useRef<number>(0); // Track messages length for retry logic
  const isPaginatingRef = useRef<boolean>(false); // Track if user is currently paginating (loading older messages)
  const lastFocusTimeRef = useRef<number>(0); // Track when screen last gained focus
  
  const isAtBottomRef = useRef<boolean>(true);
  const needsMarkAsReadRef = useRef<boolean>(false);
  
  // Background sync state - for checking new messages (uses sync service + SQLite)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const latestMessageIdRef = useRef<number | null>(null); // Track latest message ID to detect new messages
  const isPollingRef = useRef<boolean>(false); // Track if sync is active
  const POLLING_INTERVAL = DELTA_POLL_INTERVAL_MS;
  const ENABLE_CHAT_DEBUG_LOGS = __DEV__ && process.env.EXPO_PUBLIC_DEBUG_CHAT === 'true';
  const MAX_RETRY_ATTEMPTS = 5; // Maximum retry attempts
  const INITIAL_RETRY_DELAY = 1000; // Start with 1 second delay
  
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
  const loadMessagesFromDb = useCallback(async (limit: number = MESSAGES_PER_PAGE): Promise<Message[]> => {
    if (!dbInitialized) return [];
    try {
      return (await loadMessagesFromCache(Number(id), 'group', limit)) as Message[];
    } catch (error) {
      console.error('[GroupChat] Error loading messages from database:', error);
      return [];
    }
  }, [id, dbInitialized]);

  // Fetch messages
  // ✅ API-FIRST STRATEGY: Try API first, fallback to SQLite only if API fails
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
          if (showLoading) setLoading(false);
        }
      } catch (cacheError) {
        console.error('[GroupChat] Cache-first load failed:', cacheError);
      }
    }
    
    // Background API fetch
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
      apiMessages = mapApiMessages(processedMessages) as Message[];
      apiSuccess = true;

      if (dbInitialized) {
        try {
          await persistApiMessages(Number(id), 'group', apiMessages);
        } catch (dbError) {
          console.error('[GroupChat] Error saving messages to database:', dbError);
        }
      }
      
      // Set group info
      setGroupInfo(response.data.selectedConversation);
      
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
      setMessages(prev => {
        const merged = mergeMessagesWithPending(apiMessages, prev) as Message[];
        messagesLengthRef.current = merged.length;
        if (merged.length > 0) {
          latestMessageIdRef.current = merged[merged.length - 1].id;
        }
        return merged;
      });
      
      setLoadedMessagesCount(messagesLengthRef.current);
      
      if (apiMessages.length > 0) {
        const latestMsg = apiMessages[apiMessages.length - 1];
        latestMessageIdRef.current = latestMsg.id;
      }
      
      if (showLoading) {
        setLoading(false);
      }
    } else {
      // ❌ API failed - fallback to SQLite
      if (dbInitialized) {
        try {
          const sqliteMessages = await loadMessagesFromDb(MESSAGES_PER_PAGE);
          
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
          console.error('[GroupChat] Error loading from SQLite fallback:', sqliteError);
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
    }, [id, updateUnreadCount]);

  // Update messages length ref when messages change
  useEffect(() => {
    messagesLengthRef.current = messages.length;
    // Update latest message ID when messages change
    if (messages.length > 0) {
      const latestMsg = messages[messages.length - 1];
      latestMessageIdRef.current = latestMsg.id;
    }
  }, [messages.length]);
  
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
      const res = await messagesAPI.getByGroupSince(Number(id), undefined, latestId);
      const messagesData = res.data.messages?.data || res.data.messages || res.data || [];
      if (!Array.isArray(messagesData) || messagesData.length === 0) return;

      const delta = mapApiMessages(messagesData) as Message[];
      const newOnly = delta.filter((msg) => msg.id > latestId);
      if (newOnly.length === 0) return;

      if (dbInitialized) {
        await persistApiMessages(Number(id), 'group', newOnly);
      }

      setMessages((prev) => mergeDeltaMessages(prev, newOnly) as Message[]);
      latestMessageIdRef.current = newOnly[newOnly.length - 1].id;

      if (isAtBottomRef.current) {
        requestAnimationFrame(() => {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
        });
      }
    } catch (error) {
      if (__DEV__) {
        console.log('[GroupChat] Polling error (silent):', (error as Error)?.message);
      }
    } finally {
      isPollingRef.current = false;
    }
  }, [id, loadingMore, sending, dbInitialized]);

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
  }, [id, loadingMore, sending, dbInitialized, pollForNewMessages]); // CRITICAL FIX: Removed 'messages.length' to prevent stale closure
  
  // ✅ NEW: Retry service removed - users can manually retry failed messages from UI
  
  // Initial fetch on mount
  useEffect(() => {
    // Reset retry state when conversation changes
    retryAttemptRef.current = 0;
    messagesLengthRef.current = 0; // Reset messages length ref
    isPaginatingRef.current = false; // Reset pagination flag
    lastFocusTimeRef.current = 0; // Reset focus time
    latestMessageIdRef.current = null; // Reset latest message ID
    isPollingRef.current = false; // Reset sync flag
    
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

  // Inverted list: newest message lives at offset 0 (visual bottom)
  const scrollToBottom = useCallback((animated = false) => {
    if (!flatListRef.current || messages.length === 0) return;
    flatListRef.current.scrollToOffset({ offset: 0, animated });
  }, [messages.length]);

  const markGroupConversationAsRead = useCallback(async () => {
    if (!ENABLE_MARK_AS_READ || !id || !user) return;

    updateUnreadCount(Number(id), 0);

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
      const result = await markGroupChatAsRead(Number(id));
      needsMarkAsReadRef.current = !result.ok && !result.skipped && !result.rateLimited;
    } catch (error: any) {
      const isNetworkError =
        error?.code === 'ERR_NETWORK' ||
        error?.message?.includes('Network Error') ||
        !error?.response;

      if (isNetworkError) {
        needsMarkAsReadRef.current = true;
      } else if (__DEV__ && error?.response?.status !== 429) {
        console.log('[GroupChat] mark as read failed:', error?.response?.status || error?.message);
      }
    }
  }, [ENABLE_MARK_AS_READ, id, user, updateUnreadCount]);

  const fetchMessagesRef = useRef(fetchMessages);
  const markGroupConversationAsReadRef = useRef(markGroupConversationAsRead);
  const loadingMoreRef = useRef(loadingMore);
  const sendingRef = useRef(sending);
  const currentPageRef = useRef(currentPage);
  const setActiveConversationRef = useRef(setActiveConversation);
  const clearActiveConversationRef = useRef(clearActiveConversation);
  fetchMessagesRef.current = fetchMessages;
  markGroupConversationAsReadRef.current = markGroupConversationAsRead;
  loadingMoreRef.current = loadingMore;
  sendingRef.current = sending;
  currentPageRef.current = currentPage;
  setActiveConversationRef.current = setActiveConversation;
  clearActiveConversationRef.current = clearActiveConversation;

  useEffect(() => {
    const conversationId = Number(id);
    if (!conversationId) return;

    const unsubChannel = subscribeConversationChannel({
      conversationId,
      conversationType: 'group',
    });

    const unsubHandler = onRealtimeMessage((message) => {
      if (message.group_id !== conversationId) return;

      void handleRealtimeMessage(conversationId, 'group', message, (applyMerge) => {
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
      unsubChannel();
      unsubHandler();
    };
  }, [id]);

  // Mark messages as read and refresh messages when group chat is opened
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
        void markGroupConversationAsReadRef.current();
        return () => {
          clearActiveConversationRef.current();
        };
      }

      const hasExistingMessages = messagesLengthRef.current > 0;

      if (!hasExistingMessages) {
        isAtBottomRef.current = true;
      }

      void fetchMessagesRef.current(!hasExistingMessages);
      void markGroupConversationAsReadRef.current();

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
        setTimeout(() => markGroupConversationAsRead(), 500);
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, [id, user, ENABLE_MARK_AS_READ, markGroupConversationAsRead]);

  // Load more messages function
  const loadMoreMessages = async () => {
    if (loadingMore || !hasMoreMessages) return;
    
    // CRITICAL FIX: Disable auto-scroll when loading older messages
    // User wants to stay at the top viewing old messages
    isAtBottomRef.current = false;
    isPaginatingRef.current = true;
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
      groupId: Number(id),
      replyToId: replySnapshot?.id ?? null,
      attachment: attachmentSnapshot,
      voiceRecording: voiceSnapshot,
    });

    const uiMessage: Message = {
      id: 0,
      client_message_id: clientMessageId,
      sender_id: senderId,
      group_id: Number(id),
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
          const saved = await persistOutgoingMessage(Number(id), 'group', {
            client_message_id: clientMessageId,
            sender_id: senderId,
            group_id: Number(id),
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
          console.error('[GroupChat] Error saving to SQLite:', dbError);
        }
      }

      await enqueueOutgoingMessage({
        clientMessageId,
        localMessageId,
        conversationId: Number(id),
        conversationType: 'group',
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
      requestAnimationFrame(() => setTimeout(() => scrollToBottom(true), attachment || voiceRecording ? 200 : 50));

      usersAPI.updateLastSeen().catch(() => {});

    } catch (e: unknown) {
      const error = e as Error;
      console.error('[GroupChat] Error in handleSend:', error);
      setSending(false);
      Alert.alert('Error', 'Failed to save message. Please try again.', [{ text: 'OK' }]);
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

  // Dismiss a failed message (remove it)
  const dismissFailedMessage = async (messageId: number) => {
    try {
      if (ENABLE_CHAT_DEBUG_LOGS) {
        console.log(`[GroupChat] 🗑️ Dismissing failed message ${messageId}`);
      }
      
      if (dbInitialized) {
        await deleteDbMessage(messageId);
      }
      
      setMessages(prev => prev.filter(msg => msg.id !== messageId));
    } catch (error) {
      console.error('[GroupChat] Error dismissing failed message:', error);
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
    // Inverted data: the chronologically older message sits at index + 1
    const previousMessage = index < invertedMessages.length - 1 ? invertedMessages[index + 1] : null;
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
                    {item.edited_at && ' • Edited'}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        );
      }
      
      return (
        <View>
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
          
          {/* ✅ NEW: Retry/Dismiss buttons for failed voice messages */}
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
                data={invertedMessages}
                renderItem={renderItem}
              inverted
              initialNumToRender={25}
              windowSize={10}
              maxToRenderPerBatch={15}
              removeClippedSubviews={false}
              updateCellsBatchingPeriod={50}
              extraData={messages.length}
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
