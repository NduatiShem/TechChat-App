import type { DatabaseAttachment, DatabaseConversation, DatabaseMessage, MessageWithAttachments, SyncState } from '@/types/database';
import { runMigrations } from '@/utils/dbMigrations';
import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

// Database operation queue to serialize write operations and prevent locks
type QueueOperation<T> = () => Promise<T>;
interface QueueItem<T> {
  operation: QueueOperation<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
}

class DatabaseWriteQueue {
  private queue: QueueItem<any>[] = [];
  private processing = false;

  async enqueue<T>(operation: QueueOperation<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      try {
        const result = await item.operation();
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }
    }

    this.processing = false;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  isProcessing(): boolean {
    return this.processing;
  }
}

// Global write queue instance
const writeQueue = new DatabaseWriteQueue();

// Helper function to check if error is a database locked error
function isDatabaseLockedError(error: any): boolean {
  if (!error) return false;
  const errorMessage = error?.message || String(error) || '';
  const errorCode = error?.code || '';
  
  return (
    errorMessage.toLowerCase().includes('database is locked') ||
    errorMessage.toLowerCase().includes('database locked') ||
    errorMessage.toLowerCase().includes('locked') ||
    errorCode === 'SQLITE_BUSY' ||
    errorCode === 'SQLITE_LOCKED' ||
    errorCode === 5 || // SQLITE_BUSY
    errorCode === 6    // SQLITE_LOCKED
  );
}

// Retry helper with exponential backoff
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 5,
  initialDelay: number = 50
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Only retry if it's a database locked error
      if (!isDatabaseLockedError(error)) {
        throw error;
      }
      
      // If it's the last attempt, throw the error
      if (attempt === maxRetries - 1) {
        break;
      }
      
      // Calculate delay with exponential backoff (max 500ms)
      const delay = Math.min(initialDelay * Math.pow(2, attempt), 500);
      
      if (__DEV__) {
        console.warn(`[Database] Database locked, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

export async function initDatabase(): Promise<SQLite.SQLiteDatabase | null> {
  if (db) {
    return db;
  }

  try {
    db = await SQLite.openDatabaseAsync('techchat.db');
    await runMigrations(db);
    
    if (__DEV__) {
      console.log('[Database] Initialized successfully');
    }
    
    return db;
  } catch (error) {
    console.error('[Database] Failed to initialize:', error);
    db = null;
    return null;
  }
}

export async function getDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (!db) {
    return await initDatabase();
  }
  return db;
}

export function isDatabaseAvailable(): boolean {
  return db !== null;
}

export async function getMessages(
  conversationId: number,
  conversationType: 'individual' | 'group',
  limit: number = 50,
  offset: number = 0
): Promise<MessageWithAttachments[]> {
  try {
    const database = await getDb();
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available, returning empty array');
      }
      return [];
    }
    
    const messages = await database.getAllAsync<DatabaseMessage>(
      `SELECT * FROM messages 
       WHERE conversation_id = ? AND conversation_type = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [conversationId, conversationType, limit, offset]
    );

    const reversedMessages = messages.reverse();

    const messagesWithDetails: MessageWithAttachments[] = await Promise.all(
      reversedMessages.map(async (msg) => {
        const attachments = await database!.getAllAsync<DatabaseAttachment>(
          `SELECT * FROM attachments WHERE message_id = ?`,
          [msg.id]
        );

        let replyTo = undefined;
        if (msg.reply_to_id) {
          const replyMsg = await database!.getFirstAsync<DatabaseMessage>(
            `SELECT * FROM messages WHERE id = ?`,
            [msg.reply_to_id]
          );
          if (replyMsg) {
            const replyAttachments = await database!.getAllAsync<DatabaseAttachment>(
              `SELECT * FROM attachments WHERE message_id = ?`,
              [replyMsg.id]
            );
            replyTo = {
              id: replyMsg.id,
              message: replyMsg.message,
              sender: {
                id: replyMsg.sender_id,
                name: 'Unknown User',
              },
              attachments: replyAttachments,
              created_at: replyMsg.created_at,
            };
          }
        }

        return {
          ...msg,
          attachments: attachments.length > 0 ? attachments : undefined,
          reply_to: replyTo,
        };
      })
    );

    return messagesWithDetails;
  } catch (error) {
    console.error('[Database] Error getting messages:', error);
    return [];
  }
}

export async function saveMessages(
  messages: Array<{
    id?: number;
    server_id?: number;
    conversation_id: number;
    conversation_type: 'individual' | 'group';
    sender_id: number;
    receiver_id?: number;
    group_id?: number;
    message?: string;
    created_at: string;
    read_at?: string | null;
    edited_at?: string | null;
    reply_to_id?: number | null;
    sync_status?: 'synced' | 'pending' | 'failed';
    attachments?: Array<{
      id?: number;
      server_id?: number;
      name: string;
      mime: string;
      url: string;
      local_path?: string;
      size?: number;
      type?: string;
    }>;
  }>
): Promise<void> {
  if (!messages || messages.length === 0) {
    return;
  }

  try {
    const database = await getDb();
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available, skipping save');
      }
      return;
    }
    
    // Enqueue write operation to prevent concurrent writes
    await writeQueue.enqueue(async () => {
      // Pre-fetch all existing messages OUTSIDE transaction to avoid read-write conflicts
      const existingMessagesMap = new Map<number | string, DatabaseMessage>();
      const existingAttachmentsMap = new Map<string, DatabaseAttachment>();
      
      try {
        for (const msg of messages) {
          if (msg.server_id) {
            try {
              const existing = await database.getFirstAsync<DatabaseMessage>(
                `SELECT * FROM messages WHERE server_id = ?`,
                [msg.server_id]
              );
              if (existing) {
                existingMessagesMap.set(`server_${msg.server_id}`, existing);
              }
            } catch (e) {
              // Ignore errors, will try again in transaction
            }
          } else if (msg.id) {
            try {
              const existing = await database.getFirstAsync<DatabaseMessage>(
                `SELECT * FROM messages WHERE id = ?`,
                [msg.id]
              );
              if (existing) {
                existingMessagesMap.set(`id_${msg.id}`, existing);
              }
            } catch (e) {
              // Ignore errors, will try again in transaction
            }
          }
        }
      } catch (prefetchError) {
        // Continue anyway, will check again in transaction
        if (__DEV__) {
          console.warn('[Database] Error prefetching existing messages:', prefetchError);
        }
      }

      // Helper function to save a single message with retry logic
      const saveSingleMessage = async (msg: typeof messages[0]) => {
        // Skip invalid messages
        if (!msg.conversation_id || !msg.sender_id || !msg.created_at) {
          if (__DEV__) {
            console.warn('[Database] Skipping invalid message:', msg);
          }
          return;
        }

        return await retryWithBackoff(async () => {
          // Use pre-fetched data only - no reads inside transaction to avoid locks
          let existingMessage: DatabaseMessage | null = null;
          const key = msg.server_id ? `server_${msg.server_id}` : msg.id ? `id_${msg.id}` : null;
          if (key && existingMessagesMap.has(key)) {
            existingMessage = existingMessagesMap.get(key)!;
          }
          
          // CRITICAL FIX: If message has server_id but not found in cache, check by content+sender
          // This prevents duplicates when a message was saved with tempLocalId, then synced with server_id
          if (!existingMessage && msg.server_id && msg.message) {
            try {
              // Check if there's a message with same content+sender in same conversation without server_id
              // This handles the case where message was saved locally, then synced from API
              const potentialDuplicate = await database.getFirstAsync<DatabaseMessage>(
                `SELECT * FROM messages 
                 WHERE conversation_id = ? 
                 AND conversation_type = ? 
                 AND sender_id = ? 
                 AND message = ? 
                 AND server_id IS NULL
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [msg.conversation_id, msg.conversation_type, msg.sender_id, msg.message]
              );
              
              if (potentialDuplicate) {
                // Found a message without server_id that matches - update it instead of inserting
                existingMessage = potentialDuplicate;
                existingMessagesMap.set(`server_${msg.server_id}`, potentialDuplicate);
              }
            } catch (e) {
              // Ignore errors, will insert as new if needed
            }
          }
          
          // If not in cache and no duplicate found, assume it's a new message (will insert)
          // This prevents read-write conflicts inside transactions

          let messageId: number;

          if (existingMessage) {
            // If message has server_id, update created_at to match server timestamp
            // This prevents duplicates with different timestamps
            if (msg.server_id && msg.created_at) {
              await database.runAsync(
                `UPDATE messages SET
                  message = ?,
                  created_at = ?,
                  read_at = ?,
                  edited_at = ?,
                  sync_status = ?,
                  updated_at = datetime('now')
                WHERE id = ?`,
                [
                  (msg.message ?? existingMessage.message) || null,
                  msg.created_at, // Use server timestamp
                  (msg.read_at ?? existingMessage.read_at) || null,
                  (msg.edited_at ?? existingMessage.edited_at) || null,
                  (msg.sync_status ?? existingMessage.sync_status) || 'synced',
                  existingMessage.id,
                ]
              );
            } else {
              // Keep existing timestamp for local messages
              await database.runAsync(
                `UPDATE messages SET
                  message = ?,
                  read_at = ?,
                  edited_at = ?,
                  sync_status = ?,
                  updated_at = datetime('now')
                WHERE id = ?`,
                [
                  (msg.message ?? existingMessage.message) || null,
                  (msg.read_at ?? existingMessage.read_at) || null,
                  (msg.edited_at ?? existingMessage.edited_at) || null,
                  (msg.sync_status ?? existingMessage.sync_status) || 'synced',
                  existingMessage.id,
                ]
              );
            }
            messageId = existingMessage.id;
          } else {
            // INSERT new message (not in cache, assume new)
            // Try INSERT first, if it fails due to constraint, the retry will handle it as UPDATE
            const result = await database.runAsync(
              `INSERT INTO messages (
                server_id, conversation_id, conversation_type, sender_id, receiver_id, group_id,
                message, created_at, read_at, edited_at, reply_to_id, sync_status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                msg.server_id ?? null,
                msg.conversation_id,
                msg.conversation_type,
                msg.sender_id,
                msg.receiver_id ?? null,
                msg.group_id ?? null,
                msg.message ?? null,
                msg.created_at,
                msg.read_at ?? null,
                msg.edited_at ?? null,
                msg.reply_to_id ?? null,
                msg.sync_status ?? 'synced',
              ]
            );
            messageId = result.lastInsertRowId;
            // If INSERT fails with constraint error, retryWithBackoff will retry
            // and on retry, the pre-fetch should have the message, so it will UPDATE instead
          }

          // Handle attachments - check cache first
          if (msg.attachments && msg.attachments.length > 0 && messageId) {
            for (const attachment of msg.attachments) {
              try {
                // Skip invalid attachments
                if (!attachment.name || !attachment.mime || !attachment.url) {
                  if (__DEV__) {
                    console.warn('[Database] Skipping invalid attachment:', attachment);
                  }
                  continue;
                }

                const attachmentKey = `${messageId}_${attachment.url}`;
                let existingAttachment: DatabaseAttachment | null | undefined = existingAttachmentsMap.get(attachmentKey);
                
                if (!existingAttachment) {
                  try {
                    const fetched = await database.getFirstAsync<DatabaseAttachment>(
                      `SELECT * FROM attachments WHERE server_id = ? OR (message_id = ? AND url = ?)`,
                      [attachment.server_id ?? -1, messageId, attachment.url]
                    );
                    existingAttachment = fetched || null;
                    if (existingAttachment) {
                      existingAttachmentsMap.set(attachmentKey, existingAttachment);
                    }
                  } catch (e) {
                    // Ignore, will insert if not exists
                    existingAttachment = null;
                  }
                }

                if (!existingAttachment) {
                  await database.runAsync(
                    `INSERT INTO attachments (
                      server_id, message_id, name, mime, url, local_path, size, type, sync_status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      attachment.server_id ?? null,
                      messageId,
                      attachment.name,
                      attachment.mime,
                      attachment.url,
                      attachment.local_path ?? null,
                      attachment.size ?? null,
                      attachment.type ?? null,
                      'synced',
                    ]
                  );
                }
              } catch (attachmentError) {
                // Only log non-locked errors, locked errors will be retried
                if (!isDatabaseLockedError(attachmentError)) {
                  if (__DEV__) {
                    console.warn('[Database] Error saving attachment:', attachmentError);
                  }
                } else {
                  throw attachmentError; // Retry the whole message save
                }
              }
            }
          }
        });
      };

    // Try using transaction first with retry
    try {
      await retryWithBackoff(async () => {
        await database.withTransactionAsync(async () => {
          for (const msg of messages) {
            await saveSingleMessage(msg);
          }
        });
      });
      
      if (__DEV__) {
        console.log(`[Database] Saved ${messages.length} messages (transaction)`);
      }
    } catch (transactionError) {
      // If transaction fails, fallback to saving individually with retry
      if (__DEV__) {
        console.warn('[Database] Transaction failed, falling back to individual saves:', transactionError);
      }
      
      let successCount = 0;
      for (const msg of messages) {
        try {
          await saveSingleMessage(msg);
          successCount++;
        } catch (individualError) {
          // Only log if it's not a locked error (locked errors are already logged in retry)
          if (!isDatabaseLockedError(individualError)) {
            if (__DEV__) {
              console.warn('[Database] Failed to save individual message:', individualError);
            }
          }
        }
      }
      
      if (__DEV__) {
        console.log(`[Database] Saved ${successCount}/${messages.length} messages (individual)`);
      }
    }
    });
  } catch (error) {
    // Log error but don't throw - allow app to continue
    console.error('[Database] Error saving messages:', error);
    if (__DEV__) {
      console.error('[Database] Error details:', error instanceof Error ? error.message : String(error));
    }
  }
}

export async function markMessageAsRead(messageId: number): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;
    
    // Enqueue write operation to prevent concurrent writes
    await writeQueue.enqueue(async () => {
      await retryWithBackoff(async () => {
        await database.runAsync(
          `UPDATE messages SET read_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
          [messageId]
        );
      });
    });
  } catch (error) {
    if (!isDatabaseLockedError(error)) {
      console.error('[Database] Error marking message as read:', error);
    }
  }
}

export async function getUnreadCount(
  conversationId: number,
  conversationType: 'individual' | 'group',
  currentUserId: number
): Promise<number> {
  try {
    const database = await getDb();
    if (!database) return 0;
    const result = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM messages 
       WHERE conversation_id = ? AND conversation_type = ? 
       AND sender_id != ? AND read_at IS NULL`,
      [conversationId, conversationType, currentUserId]
    );
    return result?.count ?? 0;
  } catch (error) {
    console.error('[Database] Error getting unread count:', error);
    return 0;
  }
}

export async function isDatabaseEmpty(): Promise<boolean> {
  try {
    const database = await getDb();
    if (!database) return true;
    
    const result = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM conversations`
    );
    return (result?.count ?? 0) === 0;
  } catch (error) {
    console.error('[Database] Error checking if empty:', error);
    return true; // Assume empty on error
  }
}

// Get groups from SQLite (groups are stored in conversations table with type='group')
export async function getGroups(): Promise<DatabaseConversation[]> {
  try {
    const database = await getDb();
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available, returning empty array');
      }
      return [];
    }
    const groups = await database.getAllAsync<DatabaseConversation>(
      `SELECT * FROM conversations WHERE conversation_type = 'group' ORDER BY updated_at DESC`
    );
    return groups;
  } catch (error) {
    console.error('[Database] Error getting groups:', error);
    return [];
  }
}

export async function hasMessagesForConversation(
  conversationId: number,
  conversationType: 'individual' | 'group'
): Promise<boolean> {
  try {
    const database = await getDb();
    if (!database) return false;
    
    const result = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM messages 
       WHERE conversation_id = ? AND conversation_type = ?`,
      [conversationId, conversationType]
    );
    return (result?.count ?? 0) > 0;
  } catch (error) {
    console.error('[Database] Error checking if conversation has messages:', error);
    return false;
  }
}

export async function getConversations(conversationType?: 'individual' | 'group'): Promise<DatabaseConversation[]> {
  try {
    const database = await getDb();
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available, returning empty array');
      }
      return [];
    }
    
    let query = `SELECT * FROM conversations`;
    if (conversationType) {
      query += ` WHERE conversation_type = ?`;
      const conversations = await database.getAllAsync<DatabaseConversation>(
        `${query} ORDER BY updated_at DESC`,
        [conversationType]
      );
      return conversations;
    } else {
      const conversations = await database.getAllAsync<DatabaseConversation>(
        `${query} ORDER BY updated_at DESC`
      );
      return conversations;
    }
  } catch (error) {
    console.error('[Database] Error getting conversations:', error);
    return [];
  }
}

export async function saveConversations(
  conversations: Array<{
    conversation_id: number;
    conversation_type: 'individual' | 'group';
    user_id?: number;
    group_id?: number;
    name: string;
    email?: string;
    avatar_url?: string;
    last_message?: string;
    last_message_date?: string;
    last_message_sender_id?: number;
    last_message_read_at?: string | null;
    unread_count?: number;
    created_at?: string;
    updated_at?: string;
  }>
): Promise<void> {
  try {
    const database = await getDb();
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available, skipping save');
      }
      return;
    }
    
    // Enqueue write operation to prevent concurrent writes
    await writeQueue.enqueue(async () => {
      // Wrap transaction in try-catch to handle rollback errors with retry
      try {
        await retryWithBackoff(async () => {
          await database.withTransactionAsync(async () => {
            for (const conv of conversations) {
              try {
                const existing = await database.getFirstAsync<DatabaseConversation>(
                  `SELECT * FROM conversations 
                   WHERE conversation_id = ? AND conversation_type = ?`,
                  [conv.conversation_id, conv.conversation_type]
                );

                if (existing) {
                  await database.runAsync(
                    `UPDATE conversations SET
                      name = ?,
                      email = ?,
                      avatar_url = ?,
                      last_message = ?,
                      last_message_date = ?,
                      last_message_sender_id = ?,
                      last_message_read_at = ?,
                      unread_count = ?,
                      updated_at = ?,
                      sync_status = 'synced'
                    WHERE id = ?`,
                    [
                      conv.name,
                      conv.email ?? null,
                      conv.avatar_url ?? null,
                      conv.last_message ?? null,
                      conv.last_message_date ?? null,
                      conv.last_message_sender_id ?? null,
                      conv.last_message_read_at ?? null,
                      conv.unread_count ?? 0,
                      conv.updated_at ?? new Date().toISOString(),
                      existing.id,
                    ]
                  );
                } else {
                  await database.runAsync(
                    `INSERT INTO conversations (
                      conversation_id, conversation_type, user_id, group_id, name, email, avatar_url,
                      last_message, last_message_date, last_message_sender_id, last_message_read_at,
                      unread_count, created_at, updated_at, sync_status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      conv.conversation_id,
                      conv.conversation_type,
                      conv.user_id ?? null,
                      conv.group_id ?? null,
                      conv.name,
                      conv.email ?? null,
                      conv.avatar_url ?? null,
                      conv.last_message ?? null,
                      conv.last_message_date ?? null,
                      conv.last_message_sender_id ?? null,
                      conv.last_message_read_at ?? null,
                      conv.unread_count ?? 0,
                      conv.created_at ?? new Date().toISOString(),
                      conv.updated_at ?? new Date().toISOString(),
                      'synced',
                    ]
                  );
                }
              } catch (convError) {
                // Log error for individual conversation but continue with others
                if (!isDatabaseLockedError(convError)) {
                  console.error(`[Database] Error saving conversation ${conv.conversation_id}:`, convError);
                }
                // Don't throw - let other conversations save
              }
            }
          });
        });
      } catch (transactionError: any) {
        // Handle transaction errors, including rollback issues
        if (transactionError?.message?.includes('rollback') || 
            transactionError?.message?.includes('transaction') ||
            isDatabaseLockedError(transactionError)) {
          if (__DEV__) {
            console.warn('[Database] Transaction error, falling back to individual saves:', transactionError);
          }
          
          // Fallback: Save conversations individually with retry
          for (const conv of conversations) {
          try {
            await retryWithBackoff(async () => {
              const existing = await database.getFirstAsync<DatabaseConversation>(
                `SELECT * FROM conversations 
                 WHERE conversation_id = ? AND conversation_type = ?`,
                [conv.conversation_id, conv.conversation_type]
              );

              if (existing) {
                await database.runAsync(
                  `UPDATE conversations SET
                    name = ?,
                    email = ?,
                    avatar_url = ?,
                    last_message = ?,
                    last_message_date = ?,
                    last_message_sender_id = ?,
                    last_message_read_at = ?,
                    unread_count = ?,
                    updated_at = ?,
                    sync_status = 'synced'
                  WHERE id = ?`,
                  [
                    conv.name,
                    conv.email ?? null,
                    conv.avatar_url ?? null,
                    conv.last_message ?? null,
                    conv.last_message_date ?? null,
                    conv.last_message_sender_id ?? null,
                    conv.last_message_read_at ?? null,
                    conv.unread_count ?? 0,
                    conv.updated_at ?? new Date().toISOString(),
                    existing.id,
                  ]
                );
              } else {
                await database.runAsync(
                  `INSERT INTO conversations (
                    conversation_id, conversation_type, user_id, group_id, name, email, avatar_url,
                    last_message, last_message_date, last_message_sender_id, last_message_read_at,
                    unread_count, created_at, updated_at, sync_status
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    conv.conversation_id,
                    conv.conversation_type,
                    conv.user_id ?? null,
                    conv.group_id ?? null,
                    conv.name,
                    conv.email ?? null,
                    conv.avatar_url ?? null,
                    conv.last_message ?? null,
                    conv.last_message_date ?? null,
                    conv.last_message_sender_id ?? null,
                    conv.last_message_read_at ?? null,
                    conv.unread_count ?? 0,
                    conv.created_at ?? new Date().toISOString(),
                    conv.updated_at ?? new Date().toISOString(),
                    'synced',
                  ]
                );
              }
            });
          } catch (individualError) {
            if (!isDatabaseLockedError(individualError)) {
              console.error(`[Database] Error saving individual conversation ${conv.conversation_id}:`, individualError);
            }
          }
        }
      } else {
        // Re-throw if it's not a transaction/rollback/locked error
        throw transactionError;
      }
      }
    });

    if (__DEV__) {
      console.log(`[Database] Saved ${conversations.length} conversations`);
    }
  } catch (error) {
    console.error('[Database] Error saving conversations:', error);
  }
}

export async function getSyncState(
  conversationId: number,
  conversationType: 'individual' | 'group'
): Promise<SyncState | null> {
  try {
    const database = await getDb();
    if (!database) return null;
    const state = await database.getFirstAsync<SyncState>(
      `SELECT * FROM sync_state 
       WHERE conversation_id = ? AND conversation_type = ?`,
      [conversationId, conversationType]
    );
    return state ?? null;
  } catch (error) {
    console.error('[Database] Error getting sync state:', error);
    return null;
  }
}

export async function updateSyncState(
  conversationId: number,
  conversationType: 'individual' | 'group',
  syncStatus: 'synced' | 'syncing' | 'failed',
  lastError?: string
): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;
    
    await retryWithBackoff(async () => {
      const existing = await database.getFirstAsync<SyncState>(
        `SELECT * FROM sync_state 
         WHERE conversation_id = ? AND conversation_type = ?`,
        [conversationId, conversationType]
      );

      if (existing) {
        await database.runAsync(
          `UPDATE sync_state SET
            last_sync_timestamp = datetime('now'),
            sync_status = ?,
            last_error = ?
          WHERE conversation_id = ? AND conversation_type = ?`,
          [syncStatus, lastError ?? null, conversationId, conversationType]
        );
      } else {
        await database.runAsync(
          `INSERT INTO sync_state (
            conversation_id, conversation_type, last_sync_timestamp, sync_status, last_error
          ) VALUES (?, ?, datetime('now'), ?, ?)`,
          [conversationId, conversationType, syncStatus, lastError ?? null]
        );
      }
    });
  } catch (error) {
    if (!isDatabaseLockedError(error)) {
      console.error('[Database] Error updating sync state:', error);
    }
  }
}

export async function getPendingMessages(): Promise<DatabaseMessage[]> {
  try {
    const database = await getDb();
    if (!database) return [];
    // Get messages that are pending
    // Exclude messages that already have server_id (they're already synced)
    const messages = await database.getAllAsync<DatabaseMessage>(
      `SELECT * FROM messages 
       WHERE sync_status = 'pending' 
       AND server_id IS NULL
       ORDER BY created_at ASC`
    );
    return messages;
  } catch (error) {
    console.error('[Database] Error getting pending messages:', error);
    return [];
  }
}

export async function updateMessageStatus(
  localMessageId: number,
  serverId?: number,
  syncStatus: 'synced' | 'pending' | 'failed' = 'synced',
  serverCreatedAt?: string
): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;
    
    // Enqueue write operation to prevent concurrent writes
    await writeQueue.enqueue(async () => {
      await retryWithBackoff(async () => {
        if (serverCreatedAt) {
          // Update with server timestamp to match API response
          await database.runAsync(
            `UPDATE messages SET
              server_id = ?,
              sync_status = ?,
              created_at = ?,
              updated_at = datetime('now')
            WHERE id = ?`,
            [serverId ?? null, syncStatus, serverCreatedAt, localMessageId]
          );
        } else {
          // Keep existing timestamp if server timestamp not provided
          await database.runAsync(
            `UPDATE messages SET
              server_id = ?,
              sync_status = ?,
              updated_at = datetime('now')
            WHERE id = ?`,
            [serverId ?? null, syncStatus, localMessageId]
          );
        }
      });
    });
    
    if (__DEV__) {
      console.log(`[Database] Updated message ${localMessageId} status to ${syncStatus}${serverId ? ` with server_id ${serverId}` : ''}${serverCreatedAt ? ` and server timestamp ${serverCreatedAt}` : ''}`);
    }
  } catch (error) {
    if (!isDatabaseLockedError(error)) {
      console.error('[Database] Error updating message status:', error);
    }
  }
}

export async function updateMessageByServerId(
  serverId: number,
  updates: {
    sync_status?: 'synced' | 'pending' | 'failed';
    read_at?: string | null;
    edited_at?: string | null;
    message?: string;
  }
): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;
    
    // Enqueue write operation to prevent concurrent writes
    await writeQueue.enqueue(async () => {
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      
      if (updates.sync_status !== undefined) {
        updateFields.push('sync_status = ?');
        updateValues.push(updates.sync_status);
      }
      if (updates.read_at !== undefined) {
        updateFields.push('read_at = ?');
        updateValues.push(updates.read_at);
      }
      if (updates.edited_at !== undefined) {
        updateFields.push('edited_at = ?');
        updateValues.push(updates.edited_at);
      }
      if (updates.message !== undefined) {
        updateFields.push('message = ?');
        updateValues.push(updates.message);
      }
      
      if (updateFields.length === 0) return;
      
      updateFields.push('updated_at = datetime(\'now\')');
      updateValues.push(serverId);
      
      await retryWithBackoff(async () => {
        await database.runAsync(
          `UPDATE messages SET ${updateFields.join(', ')} WHERE server_id = ?`,
          updateValues
        );
      });
    });
    
    if (__DEV__) {
      console.log(`[Database] Updated message with server_id ${serverId}`);
    }
  } catch (error) {
    console.error('[Database] Error updating message by server_id:', error);
  }
}

export async function deleteMessage(
  serverId?: number,
  localId?: number
): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;
    
    if (!serverId && !localId) {
      if (__DEV__) {
        console.warn('[Database] Cannot delete message: no server_id or local id provided');
      }
      return;
    }
    
    // Enqueue write operation to prevent concurrent writes
    await writeQueue.enqueue(async () => {
      let messageId: number | null = null;
      
      // First, find the message to get its local ID
      if (serverId) {
        const message = await database.getFirstAsync<DatabaseMessage>(
          `SELECT id FROM messages WHERE server_id = ?`,
          [serverId]
        );
        if (message) {
          messageId = message.id;
        }
      } else if (localId) {
        messageId = localId;
      }
      
      if (!messageId) {
        if (__DEV__) {
          console.warn(`[Database] Message not found for deletion: server_id=${serverId}, local_id=${localId}`);
        }
        return;
      }
      
      await retryWithBackoff(async () => {
        // Delete attachments first (foreign key constraint)
        await database.runAsync(
          `DELETE FROM attachments WHERE message_id = ?`,
          [messageId!]
        );
        
        // Delete the message
        await database.runAsync(
          `DELETE FROM messages WHERE id = ?`,
          [messageId!]
        );
      });
    });
    
    if (__DEV__) {
      console.log(`[Database] Deleted message: server_id=${serverId}, local_id=${localId}`);
    }
  } catch (error) {
    console.error('[Database] Error deleting message:', error);
  }
}

/**
 * Fix existing duplicate messages with wrong timestamps
 * This function should be called after syncing messages from API
 * to ensure local SQLite timestamps match server timestamps
 */
export async function fixDuplicateMessagesWithWrongTimestamps(
  conversationId: number,
  conversationType: 'individual' | 'group',
  apiMessages: Array<{ id: number; created_at: string; message?: string; sender_id: number }>
): Promise<{ fixed: number; removed: number }> {
  try {
    const database = await getDb();
    if (!database) {
      return { fixed: 0, removed: 0 };
    }

    let fixed = 0;
    let removed = 0;

    await writeQueue.enqueue(async () => {
      // Create a map of server_id -> server timestamp for quick lookup
      const serverTimestamps = new Map<number, string>();
      apiMessages.forEach(msg => {
        serverTimestamps.set(msg.id, msg.created_at);
      });

      // Find all messages for this conversation
      const localMessages = await database.getAllAsync<DatabaseMessage>(
        `SELECT * FROM messages 
         WHERE conversation_id = ? AND conversation_type = ?`,
        [conversationId, conversationType]
      );

      // Group messages by server_id to find duplicates
      const messagesByServerId = new Map<number, DatabaseMessage[]>();
      const messagesWithoutServerId: DatabaseMessage[] = [];

      for (const msg of localMessages) {
        if (msg.server_id) {
          if (!messagesByServerId.has(msg.server_id)) {
            messagesByServerId.set(msg.server_id, []);
          }
          messagesByServerId.get(msg.server_id)!.push(msg);
        } else {
          messagesWithoutServerId.push(msg);
        }
      }

      // Fix messages with server_id
      for (const [serverId, duplicates] of messagesByServerId.entries()) {
        const serverTimestamp = serverTimestamps.get(serverId);
        
        if (!serverTimestamp) {
          // Server message doesn't exist anymore, skip
          continue;
        }

        // Find the message with the correct timestamp (or closest match)
        let keepMessage: DatabaseMessage | null = null;
        let hasCorrectTimestamp = false;

        for (const msg of duplicates) {
          // Check if timestamp matches server (within 1 minute tolerance)
          const localTime = new Date(msg.created_at).getTime();
          const serverTime = new Date(serverTimestamp).getTime();
          const timeDiff = Math.abs(localTime - serverTime);

          if (timeDiff < 60000) { // Within 1 minute
            keepMessage = msg;
            hasCorrectTimestamp = true;
            break;
          }
        }

        // If no message has correct timestamp, keep the first one
        if (!keepMessage) {
          keepMessage = duplicates[0];
        }

        // Update the kept message with server timestamp
        if (!hasCorrectTimestamp && keepMessage) {
          await retryWithBackoff(async () => {
            await database.runAsync(
              `UPDATE messages SET
                created_at = ?,
                updated_at = datetime('now')
              WHERE id = ?`,
              [serverTimestamp, keepMessage!.id]
            );
          });
          fixed++;
        }

        // Delete duplicate messages (keep only one)
        const toDelete = duplicates.filter(msg => msg.id !== keepMessage!.id);
        for (const msg of toDelete) {
          await retryWithBackoff(async () => {
            // Delete attachments first
            await database.runAsync(
              `DELETE FROM attachments WHERE message_id = ?`,
              [msg.id]
            );
            // Then delete message
            await database.runAsync(
              `DELETE FROM messages WHERE id = ?`,
              [msg.id]
            );
          });
          removed++;
        }
      }

      // Handle messages without server_id that might be duplicates
      // Group by content and sender (within 1 minute timestamp window)
      const contentGroups = new Map<string, DatabaseMessage[]>();
      for (const msg of messagesWithoutServerId) {
        const key = `${msg.message || ''}_${msg.sender_id}`;
        if (!contentGroups.has(key)) {
          contentGroups.set(key, []);
        }
        contentGroups.get(key)!.push(msg);
      }

      // For each content group, if multiple messages exist with timestamps within 1 minute,
      // keep only one (the most recent one with sync_status = 'synced' if any, otherwise the first)
      for (const [_, group] of contentGroups.entries()) {
        if (group.length > 1) {
          // Sort by created_at
          group.sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );

          // Check if timestamps are within 1 minute (likely duplicates)
          const firstTime = new Date(group[0].created_at).getTime();
          const allWithinMinute = group.every(msg => 
            Math.abs(new Date(msg.created_at).getTime() - firstTime) < 60000
          );

          if (allWithinMinute) {
            // Prefer synced messages, otherwise keep the first one
            const syncedMessage = group.find(msg => msg.sync_status === 'synced');
            const keepMsg = syncedMessage || group[0];
            
            // Delete others
            const toDelete = group.filter(msg => msg.id !== keepMsg.id);
            for (const msg of toDelete) {
              await retryWithBackoff(async () => {
                await database.runAsync(
                  `DELETE FROM attachments WHERE message_id = ?`,
                  [msg.id]
                );
                await database.runAsync(
                  `DELETE FROM messages WHERE id = ?`,
                  [msg.id]
                );
              });
              removed++;
            }
          }
        }
      }
    });

    if (__DEV__) {
      console.log(`[Database] Fixed ${fixed} timestamps and removed ${removed} duplicates for conversation ${conversationId}`);
    }

    return { fixed, removed };
  } catch (error) {
    console.error('[Database] Error fixing duplicate messages:', error);
    return { fixed: 0, removed: 0 };
  }
}

export async function clearDatabase(): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;
    await database.execAsync(`
      DELETE FROM attachments;
      DELETE FROM messages;
      DELETE FROM conversations;
      DELETE FROM sync_state;
    `);
    if (__DEV__) {
      console.log('[Database] Cleared all data');
    }
  } catch (error) {
    console.error('[Database] Error clearing database:', error);
  }
}



