import type { DatabaseAttachment, DatabaseConversation, DatabaseMessage, MessageWithAttachments, SyncState } from '@/types/database';
import { runMigrations } from '@/utils/dbMigrations';
import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

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
    
    // Helper function to save a single message
    const saveSingleMessage = async (msg: typeof messages[0]) => {
      // Skip invalid messages
      if (!msg.conversation_id || !msg.sender_id || !msg.created_at) {
        if (__DEV__) {
          console.warn('[Database] Skipping invalid message:', msg);
        }
        return;
      }

      let existingMessage: DatabaseMessage | null = null;
      
      try {
        if (msg.server_id) {
          existingMessage = await database.getFirstAsync<DatabaseMessage>(
            `SELECT * FROM messages WHERE server_id = ?`,
            [msg.server_id]
          );
        } else if (msg.id) {
          existingMessage = await database.getFirstAsync<DatabaseMessage>(
            `SELECT * FROM messages WHERE id = ?`,
            [msg.id]
          );
        }
      } catch (queryError) {
        if (__DEV__) {
          console.warn('[Database] Error querying existing message:', queryError);
        }
        existingMessage = null;
      }

      let messageId: number;

      try {
        if (existingMessage) {
          await database.runAsync(
            `UPDATE messages SET
              message = ?,
              read_at = ?,
              edited_at = ?,
              sync_status = ?,
              updated_at = datetime('now')
            WHERE id = ?`,
            [
              msg.message ?? existingMessage.message,
              msg.read_at ?? existingMessage.read_at,
              msg.edited_at ?? existingMessage.edited_at,
              msg.sync_status ?? existingMessage.sync_status,
              existingMessage.id,
            ]
          );
          messageId = existingMessage.id;
        } else {
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
        }
      } catch (insertError) {
        if (__DEV__) {
          console.error('[Database] Error inserting/updating message:', insertError);
        }
        throw insertError;
      }

      // Handle attachments
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

            const existingAttachment = await database.getFirstAsync<DatabaseAttachment>(
              `SELECT * FROM attachments WHERE server_id = ? OR (message_id = ? AND url = ?)`,
              [attachment.server_id ?? -1, messageId, attachment.url]
            );

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
            if (__DEV__) {
              console.warn('[Database] Error saving attachment:', attachmentError);
            }
            // Continue to next attachment
          }
        }
      }
    };

    // Try using transaction first
    try {
      await database.withTransactionAsync(async () => {
        for (const msg of messages) {
          await saveSingleMessage(msg);
        }
      });
      
      if (__DEV__) {
        console.log(`[Database] Saved ${messages.length} messages (transaction)`);
      }
    } catch (transactionError) {
      // If transaction fails, fallback to saving individually
      if (__DEV__) {
        console.warn('[Database] Transaction failed, falling back to individual saves:', transactionError);
      }
      
      let successCount = 0;
      for (const msg of messages) {
        try {
          await saveSingleMessage(msg);
          successCount++;
        } catch (individualError) {
          if (__DEV__) {
            console.warn('[Database] Failed to save individual message:', individualError);
          }
        }
      }
      
      if (__DEV__) {
        console.log(`[Database] Saved ${successCount}/${messages.length} messages (individual)`);
      }
    }
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
    await database.runAsync(
      `UPDATE messages SET read_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      [messageId]
    );
  } catch (error) {
    console.error('[Database] Error marking message as read:', error);
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

export async function getConversations(): Promise<DatabaseConversation[]> {
  try {
    const database = await getDb();
    if (!database) {
      if (__DEV__) {
        console.warn('[Database] Database not available, returning empty array');
      }
      return [];
    }
    const conversations = await database.getAllAsync<DatabaseConversation>(
      `SELECT * FROM conversations ORDER BY updated_at DESC`
    );
    return conversations;
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
    
    await database.withTransactionAsync(async () => {
      for (const conv of conversations) {
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
  } catch (error) {
    console.error('[Database] Error updating sync state:', error);
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
  syncStatus: 'synced' | 'pending' | 'failed' = 'synced'
): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;
    
    await database.runAsync(
      `UPDATE messages SET
        server_id = ?,
        sync_status = ?,
        updated_at = datetime('now')
      WHERE id = ?`,
      [serverId ?? null, syncStatus, localMessageId]
    );
    
    if (__DEV__) {
      console.log(`[Database] Updated message ${localMessageId} status to ${syncStatus}${serverId ? ` with server_id ${serverId}` : ''}`);
    }
  } catch (error) {
    console.error('[Database] Error updating message status:', error);
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
    
    await database.runAsync(
      `UPDATE messages SET ${updateFields.join(', ')} WHERE server_id = ?`,
      updateValues
    );
    
    if (__DEV__) {
      console.log(`[Database] Updated message with server_id ${serverId}`);
    }
  } catch (error) {
    console.error('[Database] Error updating message by server_id:', error);
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



