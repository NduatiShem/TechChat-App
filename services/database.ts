import type { DatabaseAttachment, DatabaseConversation, DatabaseGroup, DatabaseMessage, MessageWithAttachments, SyncState } from '@/types/database';
import { runMigrations } from '@/utils/dbMigrations';
import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;
let isInitializing = false; // Add initialization lock
let initPromise: Promise<SQLite.SQLiteDatabase | null> | null = null; // Track ongoing initialization

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
export const writeQueue = new DatabaseWriteQueue();

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
export async function retryWithBackoff<T>(
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

// CRITICAL FIX: Database health check function
export async function validateDatabase(database: SQLite.SQLiteDatabase | null): Promise<boolean> {
  if (!database) {
    return false;
  }
  
  try {
    await database.getFirstAsync('SELECT 1');
    return true;
  } catch (error: any) {
    if (error?.message?.includes('NullPointerException') || 
        error?.message?.includes('prepareAsync') ||
        error?.message?.includes('execAsync')) {
      return false;
    }
    throw error;
  }
}

export async function initDatabase(): Promise<SQLite.SQLiteDatabase | null> {
  // If already initialized, return it
  if (db) {
    // CRITICAL FIX: Validate database is still valid
    const isValid = await validateDatabase(db);
    if (isValid) {
      return db;
    } else {
      // Database is invalid, reset it
      console.warn('[Database] Existing database is invalid, reinitializing...');
      db = null;
    }
  }
  
  // If currently initializing, wait for the existing initialization
  if (isInitializing && initPromise) {
    return await initPromise;
  }
  
  // Start initialization
  isInitializing = true;
  initPromise = (async () => {
    try {
      // CRITICAL FIX: Add retry logic for database opening
      let database: SQLite.SQLiteDatabase | null = null;
      let retries = 0;
      const maxRetries = 3;
      
      while (!database && retries < maxRetries) {
        try {
          database = await SQLite.openDatabaseAsync('techchat.db');
          
          // CRITICAL FIX: Verify database is valid before running migrations
          if (!database) {
            throw new Error('Database object is null after opening');
          }
          
          // Test database is ready by doing a simple query
          await database.getFirstAsync('SELECT 1');
          
          break; // Success, exit retry loop
        } catch (openError: any) {
          retries++;
          if (retries >= maxRetries) {
            throw openError;
          }
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 200 * retries));
        }
      }
      
      if (!database) {
        throw new Error('Failed to open database after retries');
      }
      
      // CRITICAL FIX: Run migrations with error handling
      try {
        await runMigrations(database);
      } catch (migrationError: any) {
        console.error('[Database] Migration failed:', migrationError);
        // If migration fails, try to close and reopen
        try {
          await database.closeAsync();
        } catch (closeError) {
          // Ignore close errors
        }
        throw migrationError;
      }
      
      db = database;
      
      if (__DEV__) {
        console.log('[Database] Initialized successfully');
      }
      
      return db;
    } catch (error: any) {
      console.error('[Database] Failed to initialize:', error);
      db = null;
      
      // CRITICAL FIX: If it's a NullPointerException, log warning
      if (error?.message?.includes('NullPointerException')) {
        console.warn('[Database] NullPointerException detected, database may be corrupted');
      }
      
      return null;
    } finally {
      isInitializing = false;
      initPromise = null;
    }
  })();
  
  return await initPromise;
}

export async function getDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (!db && !isInitializing) {
    return await initDatabase();
  }
  
  // If initializing, wait for it
  if (isInitializing && initPromise) {
    return await initPromise;
  }
  
  // If db exists, validate it
  if (db) {
    const isValid = await validateDatabase(db);
    if (!isValid) {
      console.warn('[Database] Database invalid, reinitializing...');
      db = null;
      return await initDatabase();
    }
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
    let database = await getDb();
    if (!database) {
      // CRITICAL FIX: Wait a bit if database is still initializing
      let retries = 0;
      while (!database && retries < 3) {
        await new Promise(resolve => setTimeout(resolve, 100));
        database = await getDb();
        retries++;
      }
    }
    
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available after retries, returning empty array');
      }
      return [];
    }
    
    // ✅ CRITICAL FIX: Put all read operations through queue to prevent concurrent access
    const dbRef = database;
    return await retryWithBackoff(async () => {
      return await writeQueue.enqueue(async () => {
        // Re-validate database inside callback
        let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
        if (!dbToUse) {
          dbToUse = await getDb();
          if (!dbToUse) {
            return [];
          }
        }
        
        // Validate database is still valid
        const isValid = await validateDatabase(dbToUse);
        if (!isValid || !dbToUse) {
          return [];
        }
        
        const validDb = dbToUse;
        
        // CRITICAL FIX: Wrap query in try-catch to handle NullPointerException
        let messages: DatabaseMessage[] = [];
        try {
          messages = await validDb.getAllAsync<DatabaseMessage>(
            `SELECT * FROM messages 
             WHERE conversation_id = ? AND conversation_type = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [conversationId, conversationType, limit, offset]
          );
        } catch (queryError: any) {
          // Check if it's a NullPointerException or database not ready error
          if (queryError?.message?.includes('NullPointerException') || 
              queryError?.message?.includes('prepareAsync')) {
            console.error('[Database] Database not ready for query (NullPointerException):', queryError);
            return [];
          }
          throw queryError; // Re-throw other errors
        }

        const reversedMessages = messages.reverse();

        const messagesWithDetails = await Promise.all(
          reversedMessages.map(async (msg): Promise<MessageWithAttachments | null> => {
            let attachments: DatabaseAttachment[] = [];
            try {
              attachments = await validDb.getAllAsync<DatabaseAttachment>(
                `SELECT * FROM attachments WHERE message_id = ?`,
                [msg.id]
              );
            } catch (attachError: any) {
              if (attachError?.message?.includes('NullPointerException')) {
                console.error('[Database] Error loading attachments (NullPointerException):', attachError);
                attachments = [];
              } else {
                throw attachError;
              }
            }

            let replyTo = undefined;
            if (msg.reply_to_id) {
              try {
                const replyMsg = await validDb.getFirstAsync<DatabaseMessage>(
                  `SELECT * FROM messages WHERE id = ?`,
                  [msg.reply_to_id]
                );
                if (replyMsg) {
                  let replyAttachments: DatabaseAttachment[] = [];
                  try {
                    replyAttachments = await validDb.getAllAsync<DatabaseAttachment>(
                      `SELECT * FROM attachments WHERE message_id = ?`,
                      [replyMsg.id]
                    );
                  } catch (replyAttachError: any) {
                    if (replyAttachError?.message?.includes('NullPointerException')) {
                      console.error('[Database] Error loading reply attachments (NullPointerException):', replyAttachError);
                      replyAttachments = [];
                    } else {
                      throw replyAttachError;
                    }
                  }
                  
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
              } catch (replyError: any) {
                if (replyError?.message?.includes('NullPointerException')) {
                  console.error('[Database] Error loading reply message (NullPointerException):', replyError);
                } else {
                  throw replyError;
                }
              }
            }

            return {
              ...msg,
              attachments: attachments.length > 0 ? attachments : undefined,
              reply_to: replyTo,
            };
          })
        );

        // CRITICAL FIX: Filter out null values and ensure type safety
        return messagesWithDetails.filter((msg): msg is MessageWithAttachments => {
          return msg !== null;
        }) as MessageWithAttachments[];
      });
    });
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
    // ✅ CRITICAL FIX: Get database with retry (like saveConversations)
    let database = await getDb();
    if (!database) {
      // Wait a bit and retry
      let retries = 0;
      while (!database && retries < 5) {
        await new Promise(resolve => setTimeout(resolve, 200));
        database = await getDb();
        retries++;
      }
    }
    
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available after retries, skipping save');
      }
      return;
    }
    
    // ✅ CRITICAL FIX: Validate database is still valid before enqueueing
    const isValid = await validateDatabase(database);
    if (!isValid) {
      console.error('[Database] Database invalid (NullPointerException), reinitializing...');
      db = null; // Reset database
      database = await initDatabase(); // Try to reinitialize
      if (!database) {
        console.error('[Database] Failed to reinitialize, skipping save');
        return;
      }
    }
    
    // ✅ CRITICAL FIX: Capture database reference for use in callback
    const dbRef = database;
    
    // Enqueue write operation to prevent concurrent writes
    await writeQueue.enqueue(async () => {
      // ✅ CRITICAL FIX: Re-validate database inside callback
      let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
      if (!dbToUse) {
        dbToUse = await getDb();
        if (!dbToUse) {
          console.error('[Database] Database became null in writeQueue callback');
          return;
        }
      }
      
      // ✅ CRITICAL FIX: Validate database is still valid
      const isValid = await validateDatabase(dbToUse);
      if (!isValid || !dbToUse) {
        console.error('[Database] Database invalid in callback, skipping operation');
        return;
      }
      
      // TypeScript now knows dbToUse is not null
      const validDb = dbToUse;
      
      // Pre-fetch all existing messages OUTSIDE transaction to avoid read-write conflicts
      const existingMessagesMap = new Map<number | string, DatabaseMessage>();
      const existingAttachmentsMap = new Map<string, DatabaseAttachment>();
      
      try {
        for (const msg of messages) {
          if (msg.server_id) {
            try {
              const existing = await validDb.getFirstAsync<DatabaseMessage>(
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
              const existing = await validDb.getFirstAsync<DatabaseMessage>(
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

        // ✅ CRITICAL FIX: Remove retryWithBackoff - queue serializes operations, so retries are not needed
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
              const potentialDuplicate = await validDb.getFirstAsync<DatabaseMessage>(
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
            // ✅ CRITICAL FIX: Protect pending/failed messages from being overwritten
            // Only update sync_status if:
            // 1. Server IDs match (message was actually sent and synced)
            // 2. Pending message got server_id from sync (retry service or sync found it on server)
            // 3. Never overwrite pending/failed status unless we have proof it was sent (server_id match)
            
            const hasMatchingServerId = msg.server_id && existingMessage.server_id === msg.server_id;
            const pendingGotServerId = !existingMessage.server_id && msg.server_id && 
                                      (existingMessage.sync_status === 'pending' || existingMessage.sync_status === 'failed');
            
            // Determine new sync_status
            let newSyncStatus: string;
            if (hasMatchingServerId) {
              // Server IDs match - message was sent, safe to mark as synced
              newSyncStatus = 'synced';
            } else if (pendingGotServerId) {
              // Pending message got server_id from sync - it was found on server, mark as synced
              newSyncStatus = 'synced';
            } else if (existingMessage.sync_status === 'pending' || existingMessage.sync_status === 'failed') {
              // Keep pending/failed status - don't overwrite!
              newSyncStatus = existingMessage.sync_status;
            } else {
              // Existing message is synced or other status - use new status or default
              newSyncStatus = (msg.sync_status ?? existingMessage.sync_status) || 'synced';
            }
            
            // If message has server_id, update created_at to match server timestamp
            // This prevents duplicates with different timestamps
            if (msg.server_id && msg.created_at) {
              await validDb.runAsync(
                `UPDATE messages SET
                  server_id = ?,
                  message = ?,
                  created_at = ?,
                  read_at = ?,
                  edited_at = ?,
                  sync_status = ?,
                  updated_at = datetime('now')
                WHERE id = ?`,
                [
                  msg.server_id ?? existingMessage.server_id, // Update server_id if provided
                  (msg.message ?? existingMessage.message) || null,
                  msg.created_at, // Use server timestamp
                  (msg.read_at ?? existingMessage.read_at) || null,
                  (msg.edited_at ?? existingMessage.edited_at) || null,
                  newSyncStatus, // Use protected status
                  existingMessage.id,
                ]
              );
            } else {
              // Keep existing timestamp for local messages
              await validDb.runAsync(
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
                  newSyncStatus, // Use protected status
                  existingMessage.id,
                ]
              );
            }
            messageId = existingMessage.id;
          } else {
            // INSERT new message (not in cache, assume new)
            // ✅ CRITICAL FIX: Use provided id if available (for tempLocalId from handleSend)
            // This ensures the ID used for marking matches the ID in the database
            if (msg.id && typeof msg.id === 'number') {
              // Try to insert with provided ID (tempLocalId)
              try {
                const result = await validDb.runAsync(
                  `INSERT INTO messages (
                    id, server_id, conversation_id, conversation_type, sender_id, receiver_id, group_id,
                    message, created_at, read_at, edited_at, reply_to_id, sync_status
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    msg.id, // Use provided ID (tempLocalId)
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
                messageId = msg.id; // Use provided ID
                if (__DEV__) {
                  console.log(`[Database] Inserted message with provided ID: ${msg.id}`);
                }
              } catch (insertError: any) {
                // If insert fails (e.g., ID already exists), fall back to auto-increment
                if (insertError?.message?.includes('UNIQUE constraint') || insertError?.message?.includes('PRIMARY KEY')) {
                  if (__DEV__) {
                    console.warn(`[Database] Provided ID ${msg.id} already exists, using auto-increment instead`);
                  }
                  // Fall through to auto-increment INSERT below
                } else {
                  throw insertError; // Re-throw other errors
                }
              }
            }
            
            // If no ID provided or insert with provided ID failed, use auto-increment
            if (!messageId) {
              const result = await validDb.runAsync(
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
              if (__DEV__) {
                console.log(`[Database] Inserted message with auto-increment ID: ${messageId}`);
              }
            }
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
                    const fetched = await validDb.getFirstAsync<DatabaseAttachment>(
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
                  await validDb.runAsync(
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
      };

      // ✅ CRITICAL FIX: Remove retryWithBackoff - queue serializes operations, so retries are not needed
      // Try using transaction first
      try {
        await validDb.withTransactionAsync(async () => {
          for (const msg of messages) {
            await saveSingleMessage(msg);
          }
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
      // ✅ CRITICAL FIX: Remove retryWithBackoff - queue serializes operations, so retries are not needed
      await database.runAsync(
        `UPDATE messages SET read_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        [messageId]
      );
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
    
    // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
    const dbRef = database;
    return await retryWithBackoff(async () => {
      return await writeQueue.enqueue(async () => {
        // Re-validate database inside callback
        let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
        if (!dbToUse) {
          dbToUse = await getDb();
          if (!dbToUse) {
            return 0;
          }
        }
        
        // Validate database is still valid
        const isValid = await validateDatabase(dbToUse);
        if (!isValid || !dbToUse) {
          return 0;
        }
        
        const validDb = dbToUse;
        const result = await validDb.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM messages 
           WHERE conversation_id = ? AND conversation_type = ? 
           AND sender_id != ? AND read_at IS NULL`,
          [conversationId, conversationType, currentUserId]
        );
        return result?.count ?? 0;
      });
    });
  } catch (error) {
    console.error('[Database] Error getting unread count:', error);
    return 0;
  }
}

export async function isDatabaseEmpty(): Promise<boolean> {
  try {
    const database = await getDb();
    if (!database) return true;
    
    // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
    const dbRef = database;
    return await retryWithBackoff(async () => {
      return await writeQueue.enqueue(async () => {
        // Re-validate database inside callback
        let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
        if (!dbToUse) {
          dbToUse = await getDb();
          if (!dbToUse) {
            return true;
          }
        }
        
        // Validate database is still valid
        const isValid = await validateDatabase(dbToUse);
        if (!isValid || !dbToUse) {
          return true;
        }
        
        const validDb = dbToUse;
        const result = await validDb.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM conversations`
        );
        return (result?.count ?? 0) === 0;
      });
    });
  } catch (error) {
    console.error('[Database] Error checking if empty:', error);
    return true; // Assume empty on error
  }
}

// Groups table functions (using dedicated groups table)
export async function getGroups(): Promise<DatabaseGroup[]> {
  try {
    const database = await getDb();
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available, returning empty array');
      }
      return [];
    }
    
    // CRITICAL FIX: Ensure groups table exists (preventive measure)
    try {
      await database.getFirstAsync('SELECT 1 FROM groups LIMIT 1');
    } catch (tableError: any) {
      if (tableError?.message?.includes('no such table: groups')) {
        console.warn('[Database] Groups table does not exist, creating it...');
        try {
          await database.execAsync(`
            CREATE TABLE IF NOT EXISTS groups (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              description TEXT,
              owner_id INTEGER,
              avatar_url TEXT,
              member_count INTEGER DEFAULT 0,
              last_message TEXT,
              last_message_date TEXT,
              unread_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now')),
              last_synced_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
          `);
          await database.execAsync(`
            CREATE INDEX IF NOT EXISTS idx_groups_updated_at ON groups(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_groups_owner_id ON groups(owner_id);
          `);
          console.log('[Database] Groups table created successfully');
        } catch (createError) {
          console.error('[Database] Failed to create groups table:', createError);
          return [];
        }
      } else {
        throw tableError;
      }
    }
    
    // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
    const dbRef = database;
    return await retryWithBackoff(async () => {
      return await writeQueue.enqueue(async () => {
        // Re-validate database inside callback
        let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
        if (!dbToUse) {
          dbToUse = await getDb();
          if (!dbToUse) {
            return [];
          }
        }
        
        // Validate database is still valid
        const isValid = await validateDatabase(dbToUse);
        if (!isValid || !dbToUse) {
          return [];
        }
        
        const validDb = dbToUse;
        
        // CRITICAL FIX: Ensure groups table exists (preventive measure)
        try {
          await validDb.getFirstAsync('SELECT 1 FROM groups LIMIT 1');
        } catch (tableError: any) {
          if (tableError?.message?.includes('no such table: groups')) {
            console.warn('[Database] Groups table does not exist, creating it...');
            try {
              await validDb.execAsync(`
                CREATE TABLE IF NOT EXISTS groups (
                  id INTEGER PRIMARY KEY,
                  name TEXT NOT NULL,
                  description TEXT,
                  owner_id INTEGER,
                  avatar_url TEXT,
                  member_count INTEGER DEFAULT 0,
                  last_message TEXT,
                  last_message_date TEXT,
                  unread_count INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL DEFAULT (datetime('now')),
                  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                  last_synced_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
              `);
              await validDb.execAsync(`
                CREATE INDEX IF NOT EXISTS idx_groups_updated_at ON groups(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_groups_owner_id ON groups(owner_id);
              `);
              console.log('[Database] Groups table created successfully');
            } catch (createError) {
              console.error('[Database] Failed to create groups table:', createError);
              return [];
            }
          } else {
            throw tableError;
          }
        }
        
        const groups = await validDb.getAllAsync<DatabaseGroup>(
          `SELECT * FROM groups ORDER BY updated_at DESC`
        );
        
        return groups || [];
      });
    });
  } catch (error) {
    console.error('[Database] Error getting groups:', error);
    return [];
  }
}

export async function saveGroups(
  groups: Array<{
    id: number;
    name: string;
    description?: string | null;
    owner_id?: number | null;
    avatar_url?: string | null;
    member_count?: number;
    last_message?: string | null;
    last_message_date?: string | null;
    unread_count?: number;
    created_at?: string;
    updated_at?: string;
  }>
): Promise<void> {
  if (!groups || groups.length === 0) {
    return;
  }

  try {
    // CRITICAL FIX: Get database with retry
    let database = await getDb();
    if (!database) {
      // Wait a bit and retry
      let retries = 0;
      while (!database && retries < 5) {
        await new Promise(resolve => setTimeout(resolve, 200));
        database = await getDb();
        retries++;
      }
    }
    
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available after retries, skipping save');
      }
      return;
    }
    
    // CRITICAL FIX: Validate database is still valid before enqueueing
    const isValid = await validateDatabase(database);
    if (!isValid) {
      console.error('[Database] Database invalid (NullPointerException), reinitializing...');
      db = null; // Reset database
      database = await initDatabase(); // Try to reinitialize
      if (!database) {
        console.error('[Database] Failed to reinitialize, skipping save');
        return;
      }
    }
    
    // CRITICAL FIX: Capture database reference for use in callback
    const dbRef = database;
    
    // Enqueue write operation to prevent concurrent writes
    await writeQueue.enqueue(async () => {
      // CRITICAL FIX: Re-validate database inside callback
      let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
      if (!dbToUse) {
        dbToUse = await getDb();
        if (!dbToUse) {
          console.error('[Database] Database became null in writeQueue callback');
          return;
        }
      }
      
      // CRITICAL FIX: Validate database is still valid
      const isValid = await validateDatabase(dbToUse);
      if (!isValid || !dbToUse) {
        console.error('[Database] Database invalid in callback, skipping operation');
        return;
      }
      
      // CRITICAL FIX: Ensure groups table exists (preventive measure)
      try {
        await dbToUse.getFirstAsync('SELECT 1 FROM groups LIMIT 1');
      } catch (tableError: any) {
        if (tableError?.message?.includes('no such table: groups')) {
          console.warn('[Database] Groups table does not exist, creating it...');
          try {
            await dbToUse.execAsync(`
              CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                owner_id INTEGER,
                avatar_url TEXT,
                member_count INTEGER DEFAULT 0,
                last_message TEXT,
                last_message_date TEXT,
                unread_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_synced_at TEXT NOT NULL DEFAULT (datetime('now'))
              );
            `);
            await dbToUse.execAsync(`
              CREATE INDEX IF NOT EXISTS idx_groups_updated_at ON groups(updated_at DESC);
              CREATE INDEX IF NOT EXISTS idx_groups_owner_id ON groups(owner_id);
            `);
            console.log('[Database] Groups table created successfully');
          } catch (createError) {
            console.error('[Database] Failed to create groups table:', createError);
            return; // Can't proceed without the table
          }
        } else {
          throw tableError; // Re-throw if it's a different error
        }
      }
      
      // TypeScript now knows dbToUse is not null
      const validDb = dbToUse;
      
      // ✅ CRITICAL FIX: Remove retryWithBackoff - queue serializes operations, so retries are not needed
      // If operation fails, it should fail fast and let next operation proceed
      try {
        await validDb.withTransactionAsync(async () => {
          for (const group of groups) {
              try {
                // Check if group already exists
                const existing = await validDb.getFirstAsync<{ id: number }>(
                  `SELECT id FROM groups WHERE id = ?`,
                  [group.id]
                );
                
                if (existing) {
                  // Update existing group
                  await validDb.runAsync(
                    `UPDATE groups SET
                      name = ?,
                      description = ?,
                      owner_id = ?,
                      avatar_url = ?,
                      member_count = ?,
                      last_message = ?,
                      last_message_date = ?,
                      unread_count = ?,
                      updated_at = ?,
                      last_synced_at = ?
                    WHERE id = ?`,
                    [
                      group.name,
                      group.description ?? null,
                      group.owner_id ?? null,
                      group.avatar_url ?? null,
                      group.member_count ?? 0,
                      group.last_message ?? null,
                      group.last_message_date ?? null,
                      group.unread_count ?? 0,
                      group.updated_at ?? new Date().toISOString(),
                      new Date().toISOString(),
                      group.id,
                    ]
                  );
                } else {
                  // Insert new group
                  await validDb.runAsync(
                    `INSERT INTO groups (
                      id, name, description, owner_id, avatar_url, member_count,
                      last_message, last_message_date, unread_count,
                      created_at, updated_at, last_synced_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      group.id,
                      group.name,
                      group.description ?? null,
                      group.owner_id ?? null,
                      group.avatar_url ?? null,
                      group.member_count ?? 0,
                      group.last_message ?? null,
                      group.last_message_date ?? null,
                      group.unread_count ?? 0,
                      group.created_at ?? new Date().toISOString(),
                      group.updated_at ?? new Date().toISOString(),
                      new Date().toISOString(),
                    ]
                  );
                }
              } catch (groupError) {
                // Log error for individual group but continue with others
                if (!isDatabaseLockedError(groupError)) {
                  console.error(`[Database] Error saving group ${group.id}:`, groupError);
                }
                // Don't throw - let other groups save
              }
            }
          });
      } catch (transactionError: any) {
        // Handle transaction errors, including rollback issues
        if (transactionError?.message?.includes('rollback') || 
            transactionError?.message?.includes('transaction')) {
          console.error('[Database] Transaction error (possibly rollback issue):', transactionError);
          // Don't throw - allow app to continue
        } else {
          throw transactionError; // Re-throw other errors
        }
      }
    });
  } catch (error) {
    // Log error but don't throw - allow app to continue
    console.error('[Database] Error saving groups:', error);
    if (__DEV__) {
      console.error('[Database] Error details:', error instanceof Error ? error.message : String(error));
    }
  }
}

export async function hasMessagesForConversation(
  conversationId: number,
  conversationType: 'individual' | 'group'
): Promise<boolean> {
  try {
    const database = await getDb();
    if (!database) return false;
    
    // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
    const dbRef = database;
    return await retryWithBackoff(async () => {
      return await writeQueue.enqueue(async () => {
        // Re-validate database inside callback
        let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
        if (!dbToUse) {
          dbToUse = await getDb();
          if (!dbToUse) {
            return false;
          }
        }
        
        // Validate database is still valid
        const isValid = await validateDatabase(dbToUse);
        if (!isValid || !dbToUse) {
          return false;
        }
        
        const validDb = dbToUse;
        const result = await validDb.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM messages 
           WHERE conversation_id = ? AND conversation_type = ?`,
          [conversationId, conversationType]
        );
        return (result?.count ?? 0) > 0;
      });
    });
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
    
    // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
    const dbRef = database;
    return await retryWithBackoff(async () => {
      return await writeQueue.enqueue(async () => {
        // Re-validate database inside callback
        let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
        if (!dbToUse) {
          dbToUse = await getDb();
          if (!dbToUse) {
            return [];
          }
        }
        
        // Validate database is still valid
        const isValid = await validateDatabase(dbToUse);
        if (!isValid || !dbToUse) {
          return [];
        }
        
        const validDb = dbToUse;
        
        let query = `SELECT * FROM conversations`;
        if (conversationType) {
          query += ` WHERE conversation_type = ?`;
          const conversations = await validDb.getAllAsync<DatabaseConversation>(
            `${query} ORDER BY updated_at DESC`,
            [conversationType]
          );
          return conversations;
        } else {
          const conversations = await validDb.getAllAsync<DatabaseConversation>(
            `${query} ORDER BY updated_at DESC`
          );
          return conversations;
        }
      });
    });
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
    // CRITICAL FIX: Get database with retry
    let database = await getDb();
    if (!database) {
      // Wait a bit and retry
      let retries = 0;
      while (!database && retries < 5) {
        await new Promise(resolve => setTimeout(resolve, 200));
        database = await getDb();
        retries++;
      }
    }
    
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available after retries, skipping save');
      }
      return;
    }
    
    // CRITICAL FIX: Validate database is still valid before enqueueing
    const isValid = await validateDatabase(database);
    if (!isValid) {
      console.error('[Database] Database invalid (NullPointerException), reinitializing...');
      db = null; // Reset database
      database = await initDatabase(); // Try to reinitialize
      if (!database) {
        console.error('[Database] Failed to reinitialize, skipping save');
        return;
      }
    }
    
    // CRITICAL FIX: Capture database reference for use in callback
    const dbRef = database;
    
    // Enqueue write operation to prevent concurrent writes
    await writeQueue.enqueue(async () => {
      // CRITICAL FIX: Re-validate database inside callback
      let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
      if (!dbToUse) {
        dbToUse = await getDb();
        if (!dbToUse) {
          console.error('[Database] Database became null in writeQueue callback');
          return;
        }
      }
      
      // CRITICAL FIX: Validate database is still valid
      const isValid = await validateDatabase(dbToUse);
      if (!isValid || !dbToUse) {
        console.error('[Database] Database invalid in callback, skipping operation');
        return;
      }
      
      // TypeScript now knows dbToUse is not null
      const validDb = dbToUse;
      
      // ✅ CRITICAL FIX: Remove retryWithBackoff - queue serializes operations, so retries are not needed
      // If operation fails, it should fail fast and let next operation proceed
      try {
        await validDb.withTransactionAsync(async () => {
          for (const conv of conversations) {
              try {
                const existing = await validDb.getFirstAsync<DatabaseConversation>(
                  `SELECT * FROM conversations 
                   WHERE conversation_id = ? AND conversation_type = ?`,
                  [conv.conversation_id, conv.conversation_type]
                );

                if (existing) {
                  await validDb.runAsync(
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
                  await validDb.runAsync(
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
      } catch (transactionError: any) {
        // Handle transaction errors, including rollback issues
        if (transactionError?.message?.includes('rollback') || 
            transactionError?.message?.includes('transaction') ||
            isDatabaseLockedError(transactionError)) {
          if (__DEV__) {
            console.warn('[Database] Transaction error, falling back to individual saves:', transactionError);
          }
          
          // Fallback: Save conversations individually (no retry - queue handles serialization)
          for (const conv of conversations) {
            try {
              // CRITICAL FIX: Re-validate database in fallback
              let fallbackDb: SQLite.SQLiteDatabase | null = dbToUse;
              if (!fallbackDb) {
                fallbackDb = await getDb();
                if (!fallbackDb) {
                  throw new Error('Database not available in fallback');
                }
              }
              
              const isValid = await validateDatabase(fallbackDb);
              if (!isValid || !fallbackDb) {
                throw new Error('Database invalid in fallback');
              }
              
              const validFallbackDb = fallbackDb;
              
              const existing = await validFallbackDb.getFirstAsync<DatabaseConversation>(
                `SELECT * FROM conversations 
                 WHERE conversation_id = ? AND conversation_type = ?`,
                [conv.conversation_id, conv.conversation_type]
              );

              if (existing) {
                await validFallbackDb.runAsync(
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
                await validFallbackDb.runAsync(
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
    
    // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
    const dbRef = database;
    return await retryWithBackoff(async () => {
      return await writeQueue.enqueue(async () => {
        // Re-validate database inside callback
        let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
        if (!dbToUse) {
          dbToUse = await getDb();
          if (!dbToUse) {
            return null;
          }
        }
        
        // Validate database is still valid
        const isValid = await validateDatabase(dbToUse);
        if (!isValid || !dbToUse) {
          return null;
        }
        
        const validDb = dbToUse;
        const state = await validDb.getFirstAsync<SyncState>(
          `SELECT * FROM sync_state 
           WHERE conversation_id = ? AND conversation_type = ?`,
          [conversationId, conversationType]
        );
        return state ?? null;
      });
    });
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
    
    // ✅ CRITICAL FIX: Move retryWithBackoff outside queue (wrap enqueue call)
    const dbRef = database;
    await retryWithBackoff(async () => {
      return await writeQueue.enqueue(async () => {
        // Re-validate database inside callback
        let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
        if (!dbToUse) {
          dbToUse = await getDb();
          if (!dbToUse) {
            return;
          }
        }
        
        // Validate database is still valid
        const isValid = await validateDatabase(dbToUse);
        if (!isValid || !dbToUse) {
          return;
        }
        
        const validDb = dbToUse;
        const existing = await validDb.getFirstAsync<SyncState>(
          `SELECT * FROM sync_state 
           WHERE conversation_id = ? AND conversation_type = ?`,
          [conversationId, conversationType]
        );

        if (existing) {
          await validDb.runAsync(
            `UPDATE sync_state SET
              last_sync_timestamp = datetime('now'),
              sync_status = ?,
              last_error = ?
            WHERE conversation_id = ? AND conversation_type = ?`,
            [syncStatus, lastError ?? null, conversationId, conversationType]
          );
        } else {
          await validDb.runAsync(
            `INSERT INTO sync_state (
              conversation_id, conversation_type, last_sync_timestamp, sync_status, last_error
            ) VALUES (?, ?, datetime('now'), ?, ?)`,
            [conversationId, conversationType, syncStatus, lastError ?? null]
          );
        }
      });
    });
  } catch (error) {
    if (!isDatabaseLockedError(error)) {
      console.error('[Database] Error updating sync state:', error);
    }
  }
}

// Users table functions
export interface DatabaseUser {
  id: number;
  name: string;
  email: string;
  avatar_url?: string | null;
  created_at: string;
  updated_at: string;
  last_synced_at: string;
}

export async function getUsers(): Promise<DatabaseUser[]> {
  try {
    const database = await getDb();
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available, returning empty array');
      }
      return [];
    }
    
    // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
    const dbRef = database;
    return await retryWithBackoff(async () => {
      return await writeQueue.enqueue(async () => {
        // Re-validate database inside callback
        let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
        if (!dbToUse) {
          dbToUse = await getDb();
          if (!dbToUse) {
            return [];
          }
        }
        
        // Validate database is still valid
        const isValid = await validateDatabase(dbToUse);
        if (!isValid || !dbToUse) {
          return [];
        }
        
        const validDb = dbToUse;
        const users = await validDb.getAllAsync<DatabaseUser>(
          `SELECT * FROM users ORDER BY name ASC`
        );
        
        return users || [];
      });
    });
  } catch (error) {
    console.error('[Database] Error getting users:', error);
    return [];
  }
}

export async function saveUsers(
  users: Array<{
    id: number;
    name: string;
    email: string;
    avatar_url?: string | null;
    created_at?: string;
    updated_at?: string;
  }>
): Promise<void> {
  if (!users || users.length === 0) {
    return;
  }

  try {
    // CRITICAL FIX: Get database with retry
    let database = await getDb();
    if (!database) {
      // Wait a bit and retry
      let retries = 0;
      while (!database && retries < 5) {
        await new Promise(resolve => setTimeout(resolve, 200));
        database = await getDb();
        retries++;
      }
    }
    
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available after retries, skipping save');
      }
      return;
    }
    
    // CRITICAL FIX: Validate database is still valid before enqueueing
    const isValid = await validateDatabase(database);
    if (!isValid) {
      console.error('[Database] Database invalid (NullPointerException), reinitializing...');
      db = null; // Reset database
      database = await initDatabase(); // Try to reinitialize
      if (!database) {
        console.error('[Database] Failed to reinitialize, skipping save');
        return;
      }
    }
    
    // CRITICAL FIX: Capture database reference for use in callback
    const dbRef = database;
    
    // Enqueue write operation to prevent concurrent writes
    await writeQueue.enqueue(async () => {
      // CRITICAL FIX: Re-validate database inside callback
      let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
      if (!dbToUse) {
        dbToUse = await getDb();
        if (!dbToUse) {
          console.error('[Database] Database became null in writeQueue callback');
          return;
        }
      }
      
      // CRITICAL FIX: Validate database is still valid
      const isValid = await validateDatabase(dbToUse);
      if (!isValid || !dbToUse) {
        console.error('[Database] Database invalid in callback, skipping operation');
        return;
      }
      
      // CRITICAL FIX: Ensure users table exists (preventive measure)
      try {
        await dbToUse.getFirstAsync('SELECT 1 FROM users LIMIT 1');
      } catch (tableError: any) {
        if (tableError?.message?.includes('no such table: users')) {
          console.warn('[Database] Users table does not exist, creating it...');
          try {
            await dbToUse.execAsync(`
              CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                avatar_url TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_synced_at TEXT NOT NULL DEFAULT (datetime('now'))
              );
            `);
            await dbToUse.execAsync(`
              CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            `);
            console.log('[Database] Users table created successfully');
          } catch (createError) {
            console.error('[Database] Failed to create users table:', createError);
            return; // Can't proceed without the table
          }
        } else {
          throw tableError; // Re-throw if it's a different error
        }
      }
      
      // TypeScript now knows dbToUse is not null
      const validDb = dbToUse;
      
      // ✅ CRITICAL FIX: Remove retryWithBackoff - queue serializes operations, so retries are not needed
      // If operation fails, it should fail fast and let next operation proceed
      try {
        await validDb.withTransactionAsync(async () => {
          for (const user of users) {
              try {
                const existing = await validDb.getFirstAsync<DatabaseUser>(
                  `SELECT * FROM users WHERE id = ?`,
                  [user.id]
                );

                if (existing) {
                  await validDb.runAsync(
                    `UPDATE users SET
                      name = ?,
                      email = ?,
                      avatar_url = ?,
                      updated_at = ?,
                      last_synced_at = datetime('now')
                    WHERE id = ?`,
                    [
                      user.name,
                      user.email,
                      user.avatar_url ?? null,
                      user.updated_at ?? new Date().toISOString(),
                      user.id,
                    ]
                  );
                } else {
                  await validDb.runAsync(
                    `INSERT INTO users (
                      id, name, email, avatar_url, created_at, updated_at, last_synced_at
                    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
                    [
                      user.id,
                      user.name,
                      user.email,
                      user.avatar_url ?? null,
                      user.created_at ?? new Date().toISOString(),
                      user.updated_at ?? new Date().toISOString(),
                    ]
                  );
                }
              } catch (userError) {
                // Log error for individual user but continue with others
                if (!isDatabaseLockedError(userError)) {
                  console.error(`[Database] Error saving user ${user.id}:`, userError);
                }
                // Don't throw - let other users save
              }
            }
          });
      } catch (transactionError: any) {
        // Handle transaction errors, including rollback issues
        if (transactionError?.message?.includes('rollback') || 
            transactionError?.message?.includes('transaction') ||
            isDatabaseLockedError(transactionError)) {
          if (__DEV__) {
            console.warn('[Database] Transaction error, falling back to individual saves:', transactionError);
          }
          
          // Fallback: Save users individually (no retry - queue handles serialization)
          for (const user of users) {
            try {
              // CRITICAL FIX: Re-validate database in fallback
              let fallbackDb: SQLite.SQLiteDatabase | null = dbToUse;
                if (!fallbackDb) {
                  fallbackDb = await getDb();
                  if (!fallbackDb) {
                    throw new Error('Database not available in fallback');
                  }
                }
                
                const isValid = await validateDatabase(fallbackDb);
                if (!isValid || !fallbackDb) {
                  throw new Error('Database invalid in fallback');
                }
                
                const validFallbackDb = fallbackDb;
                
                const existing = await validFallbackDb.getFirstAsync<DatabaseUser>(
                  `SELECT * FROM users WHERE id = ?`,
                  [user.id]
                );

                if (existing) {
                  await validFallbackDb.runAsync(
                    `UPDATE users SET
                      name = ?,
                      email = ?,
                      avatar_url = ?,
                      updated_at = ?,
                      last_synced_at = datetime('now')
                    WHERE id = ?`,
                    [
                      user.name,
                      user.email,
                      user.avatar_url ?? null,
                      user.updated_at ?? new Date().toISOString(),
                      user.id,
                    ]
                  );
                } else {
                  await validFallbackDb.runAsync(
                    `INSERT INTO users (
                      id, name, email, avatar_url, created_at, updated_at, last_synced_at
                    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
                    [
                      user.id,
                      user.name,
                      user.email,
                      user.avatar_url ?? null,
                      user.created_at ?? new Date().toISOString(),
                      user.updated_at ?? new Date().toISOString(),
                    ]
                  );
                }
            } catch (individualError) {
              if (!isDatabaseLockedError(individualError)) {
                console.error(`[Database] Error saving individual user ${user.id}:`, individualError);
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
      console.log(`[Database] Saved ${users.length} users`);
    }
  } catch (error) {
    console.error('[Database] Error saving users:', error);
  }
}

export async function getPendingMessages(): Promise<DatabaseMessage[]> {
  try {
    let database = await getDb();
    if (!database) {
      // CRITICAL FIX: Wait a bit if database is still initializing
      let retries = 0;
      while (!database && retries < 3) {
        await new Promise(resolve => setTimeout(resolve, 100));
        database = await getDb();
        retries++;
      }
    }
    
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available for getPendingMessages');
      }
      return [];
    }
    
    // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
    const dbRef = database;
    return await writeQueue.enqueue(async () => {
      // Re-validate database inside callback
      let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
      if (!dbToUse) {
        dbToUse = await getDb();
        if (!dbToUse) {
          return [];
        }
      }
      
      // Validate database is still valid
      const isValid = await validateDatabase(dbToUse);
      if (!isValid || !dbToUse) {
        return [];
      }
      
      const validDb = dbToUse;
      
      // CRITICAL FIX: Add try-catch around the actual query to handle NullPointerException
      try {
        // ✅ FIX: Also get failed messages (they should be retried)
        const allMessages = await validDb.getAllAsync<DatabaseMessage>(
          `SELECT * FROM messages 
           WHERE (sync_status = 'pending' OR sync_status = 'failed')
           AND server_id IS NULL
           ORDER BY created_at ASC`
        );
        
        // ✅ CRITICAL FIX: Filter out messages that are currently being sent by handleSend
        // Import dynamically to avoid circular dependency
        const { getMessagesBeingSent } = await import('./messageRetryService');
        const messagesBeingSent = getMessagesBeingSent();
        
        console.log(`[Database] 📋 getPendingMessages: Found ${allMessages?.length || 0} pending messages | ${messagesBeingSent.size} currently being sent`);
        
        const messages = (allMessages || []).filter(msg => {
          if (messagesBeingSent.has(msg.id)) {
            console.log(`[Database] ⏭️ Excluding message ${msg.id} from pending - currently being sent by handleSend | Content: "${msg.message?.substring(0, 50)}"`);
            return false;
          }
          return true;
        });
        
        console.log(`[Database] ✅ getPendingMessages: Returning ${messages.length} messages after filtering (excluded ${(allMessages?.length || 0) - messages.length})`);
        
        return messages;
      } catch (queryError: any) {
        // Check if it's a NullPointerException or database not ready error
        if (queryError?.message?.includes('NullPointerException') || 
            queryError?.message?.includes('prepareAsync')) {
          console.error('[Database] Database not ready for query (NullPointerException):', queryError);
          return [];
        }
        // For database locked errors, return empty array (will retry later)
        if (isDatabaseLockedError(queryError)) {
          if (__DEV__) {
            console.warn('[Database] Database locked during getPendingMessages (should not happen with queue)');
          }
          return [];
        }
        throw queryError; // Re-throw other errors
      }
    });
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
): Promise<boolean> {
  // ✅ CRITICAL FIX: Track if update actually succeeded
  let updateSucceeded = false;
  
  try {
    // ✅ CRITICAL FIX: Get database with retry
    let database = await getDb();
    if (!database) {
      let retries = 0;
      while (!database && retries < 5) {
        await new Promise(resolve => setTimeout(resolve, 200));
        database = await getDb();
        retries++;
      }
    }
    
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available after retries, skipping update');
      }
      return false;
    }
    
    // ✅ CRITICAL FIX: Validate database is still valid before enqueueing
    const isValid = await validateDatabase(database);
    if (!isValid) {
      console.error('[Database] Database invalid, reinitializing...');
      db = null;
      database = await initDatabase();
      if (!database) {
        console.error('[Database] Failed to reinitialize, skipping update');
        return false;
      }
    }
    
    // ✅ CRITICAL FIX: Capture database reference for use in callback
    const dbRef = database;
    
    // ✅ CRITICAL FIX: Move ALL database operations inside write queue to prevent concurrent reads/writes
    await writeQueue.enqueue(async () => {
      // ✅ CRITICAL FIX: Re-validate database inside callback
      let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
      if (!dbToUse) {
        dbToUse = await getDb();
        if (!dbToUse) {
          console.error('[Database] Database became null in writeQueue callback');
          updateSucceeded = false;
          return;
        }
      }
      
      // ✅ CRITICAL FIX: Validate database is still valid
      const isValid = await validateDatabase(dbToUse);
      if (!isValid || !dbToUse) {
        console.error('[Database] Database invalid in callback, skipping operation');
        updateSucceeded = false;
        return;
      }
      
      // TypeScript now knows dbToUse is not null
      const validDb = dbToUse;
      
      // ✅ CRITICAL FIX: Remove retryWithBackoff - queue serializes operations, so retries are not needed
      // If operation fails, it should fail fast and let next operation proceed
      try {
        // ✅ CRITICAL FIX: Check current status INSIDE queue to prevent unnecessary writes
        try {
          const currentMessage = await validDb.getFirstAsync<{ server_id?: number; sync_status?: string }>(
            `SELECT server_id, sync_status FROM messages WHERE id = ?`,
            [localMessageId]
          );
          
          // Skip update if message already has the same status and server_id
          if (currentMessage) {
            const currentServerId = currentMessage.server_id ?? null;
            const currentSyncStatus = currentMessage.sync_status;
            const newServerId = serverId ?? null;
            
            // If already synced with same server_id, skip update (but mark as succeeded)
            if (currentSyncStatus === 'synced' && currentServerId === newServerId && newServerId !== null) {
              updateSucceeded = true; // Already in correct state
              return; // No update needed
            }
            
            // If already has server_id and we're trying to set it again, skip (but mark as succeeded)
            if (currentServerId !== null && currentServerId === newServerId && syncStatus === 'synced') {
              updateSucceeded = true; // Already in correct state
              return; // No update needed
            }
          }
        } catch (checkError) {
          // Continue with update if check fails
        }
        
        // ✅ CRITICAL FIX: Check if another message already has this server_id INSIDE queue
        if (serverId) {
          try {
            const existingMessage = await validDb.getFirstAsync<{ id: number; conversation_id: number; sender_id: number; message?: string }>(
              `SELECT id, conversation_id, sender_id, message FROM messages WHERE server_id = ? AND id != ?`,
              [serverId, localMessageId]
            );
            
            if (existingMessage) {
              // Another message already has this server_id
              // Check if it's the same message (by content/sender/conversation)
              const currentMessage = await validDb.getFirstAsync<{ conversation_id: number; sender_id: number; message?: string }>(
                `SELECT conversation_id, sender_id, message FROM messages WHERE id = ?`,
                [localMessageId]
              );
              
              if (currentMessage && 
                  currentMessage.conversation_id === existingMessage.conversation_id &&
                  currentMessage.sender_id === existingMessage.sender_id &&
                  currentMessage.message === existingMessage.message) {
                // It's the same message - delete the duplicate (keep the one with server_id)
                console.warn(`[Database] Duplicate message detected: ${localMessageId} and ${existingMessage.id} have same content. Deleting ${localMessageId}`);
                await validDb.runAsync(`DELETE FROM attachments WHERE message_id = ?`, [localMessageId]);
                await validDb.runAsync(`DELETE FROM messages WHERE id = ?`, [localMessageId]);
                updateSucceeded = true; // Duplicate handled successfully
                return; // Don't update, duplicate was deleted
              } else {
                // Different message with same server_id - this shouldn't happen, but handle gracefully
                console.error(`[Database] UNIQUE constraint violation: server_id ${serverId} already exists on message ${existingMessage.id}, cannot assign to ${localMessageId}`);
                // Don't update - keep message as pending
                updateSucceeded = false;
                return;
              }
            }
          } catch (checkError) {
            // Continue with update if check fails
          }
        }
        
        // ✅ Perform the update directly (no retry - queue handles serialization)
        if (serverCreatedAt) {
          // Update with server timestamp to match API response
          await validDb.runAsync(
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
          await validDb.runAsync(
            `UPDATE messages SET
              server_id = ?,
              sync_status = ?,
              updated_at = datetime('now')
            WHERE id = ?`,
            [serverId ?? null, syncStatus, localMessageId]
          );
        }
        
        // ✅ Mark as succeeded if we got here without error
        updateSucceeded = true;
      } catch (updateError: any) {
        // ✅ CRITICAL FIX: Handle UNIQUE constraint violations gracefully
        const errorMessage = updateError?.message || String(updateError) || '';
        if (errorMessage.includes('UNIQUE constraint') || errorMessage.includes('UNIQUE constraint failed')) {
          // Another message already has this server_id
          console.warn(`[Database] UNIQUE constraint violation for server_id ${serverId} on message ${localMessageId}. Checking for duplicate...`);
          
          try {
            // Check if another message has this server_id
            const existingMessage = await validDb.getFirstAsync<{ id: number }>(
              `SELECT id FROM messages WHERE server_id = ? AND id != ?`,
              [serverId, localMessageId]
            );
            
            if (existingMessage) {
              // Another message has this server_id - check if current message is a duplicate
              const currentMessage = await validDb.getFirstAsync<{ conversation_id: number; sender_id: number; message?: string }>(
                `SELECT conversation_id, sender_id, message FROM messages WHERE id = ?`,
                [localMessageId]
              );
              
              const duplicateMessage = await validDb.getFirstAsync<{ conversation_id: number; sender_id: number; message?: string }>(
                `SELECT conversation_id, sender_id, message FROM messages WHERE id = ?`,
                [existingMessage.id]
              );
              
              if (currentMessage && duplicateMessage &&
                  currentMessage.conversation_id === duplicateMessage.conversation_id &&
                  currentMessage.sender_id === duplicateMessage.sender_id &&
                  currentMessage.message === duplicateMessage.message) {
                // Same message - delete the duplicate (keep the one with server_id)
                console.warn(`[Database] Deleting duplicate message ${localMessageId}, keeping ${existingMessage.id} with server_id ${serverId}`);
                await validDb.runAsync(`DELETE FROM attachments WHERE message_id = ?`, [localMessageId]);
                await validDb.runAsync(`DELETE FROM messages WHERE id = ?`, [localMessageId]);
                updateSucceeded = true; // Duplicate handled successfully
                return; // Successfully handled duplicate
              } else {
                // Different messages - this is an error, but don't crash
                console.error(`[Database] Cannot assign server_id ${serverId} to message ${localMessageId} - already assigned to different message ${existingMessage.id}`);
                // Keep message as pending - don't update
                updateSucceeded = false;
                return;
              }
            } else {
              // No existing message found - might be a race condition, but don't retry (queue handles serialization)
              console.warn(`[Database] UNIQUE constraint error but no duplicate found for message ${localMessageId} with server_id ${serverId}`);
              updateSucceeded = false;
              return;
            }
          } catch (checkError) {
            // Error checking for duplicate - fail the update
            console.error(`[Database] Error checking for duplicate after UNIQUE constraint violation:`, checkError);
            updateSucceeded = false;
            return;
          }
        } else if (isDatabaseLockedError(updateError)) {
          // Database locked error - this shouldn't happen with proper queue serialization
          // But if it does, fail fast and let next operation proceed
          console.warn(`[Database] Database locked during updateMessageStatus (this shouldn't happen with queue):`, updateError);
          updateSucceeded = false;
          return;
        } else {
          // Other error - fail the update
          console.error(`[Database] Error updating message status:`, updateError);
          updateSucceeded = false;
          return;
        }
      }
    });
    
    // ✅ Return success status
    return updateSucceeded;
  } catch (error) {
    if (!isDatabaseLockedError(error)) {
      console.error('[Database] Error updating message status:', error);
    }
    return false; // Return false on error
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
    // ✅ CRITICAL FIX: Get database with retry
    let database = await getDb();
    if (!database) {
      let retries = 0;
      while (!database && retries < 5) {
        await new Promise(resolve => setTimeout(resolve, 200));
        database = await getDb();
        retries++;
      }
    }
    
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available after retries, skipping update');
      }
      return;
    }
    
    // ✅ CRITICAL FIX: Validate database is still valid before enqueueing
    const isValid = await validateDatabase(database);
    if (!isValid) {
      console.error('[Database] Database invalid, reinitializing...');
      db = null;
      database = await initDatabase();
      if (!database) {
        console.error('[Database] Failed to reinitialize, skipping update');
        return;
      }
    }
    
    // ✅ CRITICAL FIX: Capture database reference for use in callback
    const dbRef = database;
    
    // ✅ CRITICAL FIX: Move retryWithBackoff outside queue (wrap enqueue call)
    await retryWithBackoff(async () => {
      return await writeQueue.enqueue(async () => {
        // ✅ CRITICAL FIX: Re-validate database inside callback
        let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
        if (!dbToUse) {
          dbToUse = await getDb();
          if (!dbToUse) {
            console.error('[Database] Database became null in writeQueue callback');
            return;
          }
        }
        
        // ✅ CRITICAL FIX: Validate database is still valid
        const isValid = await validateDatabase(dbToUse);
        if (!isValid || !dbToUse) {
          console.error('[Database] Database invalid in callback, skipping operation');
          return;
        }
        
        // TypeScript now knows dbToUse is not null
        const validDb = dbToUse;
        
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
        
        await validDb.runAsync(
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
    
    // ✅ CRITICAL FIX: Move retryWithBackoff outside queue (wrap enqueue call)
    const dbRef = database;
    await retryWithBackoff(async () => {
      return await writeQueue.enqueue(async () => {
        // Re-validate database inside callback
        let dbToUse: SQLite.SQLiteDatabase | null = dbRef;
        if (!dbToUse) {
          dbToUse = await getDb();
          if (!dbToUse) {
            console.error('[Database] Database became null in writeQueue callback');
            return;
          }
        }
        
        // Validate database is still valid
        const isValid = await validateDatabase(dbToUse);
        if (!isValid || !dbToUse) {
          console.error('[Database] Database invalid in callback, skipping operation');
          return;
        }
        
        const validDb = dbToUse;
        let messageId: number | null = null;
        
        // First, find the message to get its local ID
        if (serverId) {
          const message = await validDb.getFirstAsync<DatabaseMessage>(
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
        
        // Delete attachments first (foreign key constraint)
        await validDb.runAsync(
          `DELETE FROM attachments WHERE message_id = ?`,
          [messageId]
        );
        
        // Delete the message
        await validDb.runAsync(
          `DELETE FROM messages WHERE id = ?`,
          [messageId]
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

      // ✅ CRITICAL FIX: Handle messages without server_id that might be duplicates
      // First, try to match pending messages with synced messages from API
      // Create a map of API messages by content+sender for matching
      const apiMessagesByContent = new Map<string, { id: number; created_at: string }>();
      for (const apiMsg of apiMessages) {
        const key = `${apiMsg.message || ''}_${apiMsg.sender_id}`;
        // Store the API message with its server_id and timestamp
        if (!apiMessagesByContent.has(key)) {
          apiMessagesByContent.set(key, { id: apiMsg.id, created_at: apiMsg.created_at });
        }
      }

      // Try to match pending messages with synced messages from API
      for (const pendingMsg of messagesWithoutServerId) {
        const key = `${pendingMsg.message || ''}_${pendingMsg.sender_id}`;
        const matchingApiMsg = apiMessagesByContent.get(key);
        
        if (matchingApiMsg) {
          // Found a match! Check if timestamp is close (within 1 minute)
          const pendingTime = new Date(pendingMsg.created_at).getTime();
          const apiTime = new Date(matchingApiMsg.created_at).getTime();
          const timeDiff = Math.abs(pendingTime - apiTime);
          
          if (timeDiff < 60000) { // Within 1 minute - likely the same message
            // Update pending message with server_id instead of deleting it
            await retryWithBackoff(async () => {
              await database.runAsync(
                `UPDATE messages SET
                  server_id = ?,
                  created_at = ?,
                  sync_status = 'synced',
                  updated_at = datetime('now')
                WHERE id = ?`,
                [matchingApiMsg.id, matchingApiMsg.created_at, pendingMsg.id]
              );
            });
            fixed++;
            // Remove from messagesWithoutServerId so it's not processed again
            const index = messagesWithoutServerId.indexOf(pendingMsg);
            if (index > -1) {
              messagesWithoutServerId.splice(index, 1);
            }
          }
        }
      }

      // Now handle remaining messages without server_id that might be duplicates
      // ✅ CRITICAL FIX: Only delete pending messages if:
      // 1. They're duplicates of each other (same content+sender within 1 minute)
      // 2. AND at least one of them matches a synced message from API (already handled above)
      // 3. OR they're true duplicates (exact same content+sender+timestamp)
      // NEVER delete pending messages that don't have a matching synced message
      const contentGroups = new Map<string, DatabaseMessage[]>();
      for (const msg of messagesWithoutServerId) {
        const key = `${msg.message || ''}_${msg.sender_id}`;
        if (!contentGroups.has(key)) {
          contentGroups.set(key, []);
        }
        contentGroups.get(key)!.push(msg);
      }

      // For each content group, only delete if there are true duplicates
      // AND we're confident they're not legitimate pending messages waiting to sync
      for (const [contentKey, group] of contentGroups.entries()) {
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

          // ✅ CRITICAL FIX: Only delete if:
          // 1. All messages are within 1 minute (likely duplicates)
          // 2. AND there's a matching synced message from API (already matched above)
          // 3. OR they're exact duplicates (same timestamp within 1 second)
          const hasMatchingApiMessage = apiMessagesByContent.has(contentKey);
          const areExactDuplicates = group.every(msg => 
            Math.abs(new Date(msg.created_at).getTime() - firstTime) < 1000
          );

          if (allWithinMinute && (hasMatchingApiMessage || areExactDuplicates)) {
            // Prefer synced messages, otherwise keep the first one
            const syncedMessage = group.find(msg => msg.sync_status === 'synced');
            const keepMsg = syncedMessage || group[0];
            
            // Delete others (only if we have a matching API message or they're exact duplicates)
            const toDelete = group.filter(msg => msg.id !== keepMsg.id);
            for (const msg of toDelete) {
              // ✅ CRITICAL: NEVER delete pending/failed messages - they're still being sent!
              // Even if they look like duplicates, they might be retry attempts
              if (msg.sync_status === 'pending' || msg.sync_status === 'failed') {
                continue; // Skip deletion - ALWAYS protect pending/failed messages
              }
              
              // Only delete synced messages that are confirmed duplicates
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







