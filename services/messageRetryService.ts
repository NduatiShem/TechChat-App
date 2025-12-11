import type { DatabaseAttachment, DatabaseMessage } from '@/types/database';
import { AppState, AppStateStatus } from 'react-native';
import { messagesAPI } from './api';
import { getDb, getPendingMessages, updateMessageStatus, writeQueue, retryWithBackoff, validateDatabase } from './database';

let retryInterval: NodeJS.Timeout | null = null;
let isRetrying = false;
let appState: AppStateStatus = 'active';
let backgroundRetryTimeout: NodeJS.Timeout | null = null;
let appStateSubscription: any = null;

/**
 * Retry sending pending/failed messages
 */
// Track messages currently being retried to prevent concurrent retries
const messagesBeingRetried = new Set<number>();

/**
 * ✅ CRITICAL FIX: Export functions to mark messages as being sent
 * This prevents retry service from picking up messages that handleSend is already sending
 * Uses in-memory Set (no database operations) - won't cause database locks
 */
export function markMessageAsSending(messageId: number): void {
  messagesBeingRetried.add(messageId);
}

export function unmarkMessageAsSending(messageId: number): void {
  messagesBeingRetried.delete(messageId);
}

export function isMessageBeingSent(messageId: number): boolean {
  return messagesBeingRetried.has(messageId);
}

/**
 * Get all message IDs currently being sent
 * Used by getPendingMessages to exclude them
 */
export function getMessagesBeingSent(): Set<number> {
  return new Set(messagesBeingRetried);
}

/**
 * ✅ CLEANUP: Mark messages with server_id as synced (safety net)
 * This catches edge cases where messages have server_id but are still marked as pending/failed
 */
async function cleanupSyncedMessages(): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;
    
    // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
    const dbRef = database;
    const messagesToCleanup = await retryWithBackoff(async () => {
      return await writeQueue.enqueue(async () => {
        // Re-validate database inside callback
        let dbToUse = dbRef;
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
        
        // Find messages that have server_id but are still marked as pending/failed
        return await validDb.getAllAsync<{ id: number; server_id: number }>(
          `SELECT id, server_id FROM messages 
           WHERE server_id IS NOT NULL 
           AND (sync_status = 'pending' OR sync_status = 'failed')
           LIMIT 100`
        );
      });
    });
    
    if (messagesToCleanup.length > 0) {
      if (__DEV__) {
        console.log(`[MessageRetry] Cleanup: Found ${messagesToCleanup.length} messages with server_id but still pending/failed`);
      }
      
      // Mark all as synced
      for (const msg of messagesToCleanup) {
        await updateMessageStatus(msg.id, msg.server_id, 'synced').catch(() => {});
      }
      
      if (__DEV__) {
        console.log(`[MessageRetry] Cleanup: Marked ${messagesToCleanup.length} messages as synced`);
      }
    }
  } catch (error) {
    // Silently fail - cleanup is not critical
    if (__DEV__) {
      console.warn('[MessageRetry] Cleanup error:', error);
    }
  }
}

export async function retryPendingMessages(): Promise<void> {
  if (isRetrying) {
    console.log(`[MessageRetry] ⏸️ Already retrying, skipping this cycle`);
    return; // Already retrying
  }

  try {
    isRetrying = true;
    const retryStartTime = Date.now();
    console.log(`[MessageRetry] 🔄 Starting retry cycle at ${new Date().toISOString()}`);
    
    // ✅ CLEANUP: First, clean up any messages that have server_id but are still pending/failed
    await cleanupSyncedMessages();
    
    const pendingMessages = await getPendingMessages();
    
    console.log(`[MessageRetry] 📋 Found ${pendingMessages.length} pending messages from database`);
    
    if (pendingMessages.length === 0) {
      console.log(`[MessageRetry] ✅ No pending messages, exiting`);
      return;
    }

    // Log all pending messages
    pendingMessages.forEach(msg => {
      console.log(`[MessageRetry] 📝 Pending message: id=${msg.id}, content="${msg.message?.substring(0, 50)}", server_id=${msg.server_id || 'NULL'}, sync_status=${msg.sync_status}, marked_as_sending=${messagesBeingRetried.has(msg.id)}`);
    });

    // Filter out messages that are already being retried or have server_id (already synced)
    const messagesToRetry = pendingMessages.filter(msg => {
      // Skip if already has server_id (already synced)
      if (msg.server_id) {
        console.log(`[MessageRetry] ⏭️ Skipping message ${msg.id} - already has server_id ${msg.server_id}`);
        // Update status to synced if it has server_id but status is still pending
        updateMessageStatus(msg.id, msg.server_id, 'synced').catch(() => {});
        return false;
      }
      
      // Skip if currently being retried
      if (messagesBeingRetried.has(msg.id)) {
        console.log(`[MessageRetry] ⏭️ Skipping message ${msg.id} - currently being sent by handleSend (marked as sending)`);
        return false;
      }
      
      return true;
    });
    
    if (messagesToRetry.length === 0) {
      console.log(`[MessageRetry] ✅ All pending messages filtered out, exiting`);
      return;
    }

    console.log(`[MessageRetry] 🚀 Retrying ${messagesToRetry.length} pending messages (filtered from ${pendingMessages.length})`);

    for (const message of messagesToRetry) {
      // Mark as being retried
      messagesBeingRetried.add(message.id);
      
      try {
        await retrySingleMessage(message);
      } catch (error) {
        if (__DEV__) {
          console.error(`[MessageRetry] Failed to retry message ${message.id}:`, error);
        }
        // Keep as pending for next retry attempt
      } finally {
        // Remove from retry set after a delay to prevent immediate re-retry
        setTimeout(() => {
          messagesBeingRetried.delete(message.id);
        }, 5000); // 5 second cooldown
      }
    }
  } catch (error) {
    console.error('[MessageRetry] Error in retryPendingMessages:', error);
  } finally {
    isRetrying = false;
  }
}

/**
 * Retry sending a single message with robust verification
 */
async function retrySingleMessage(message: DatabaseMessage): Promise<void> {
  // ✅ CRITICAL CHECK: Verify current message state before retrying
  // Message might have been saved by sync while we were waiting
  try {
    const database = await getDb();
    if (database) {
      // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
      const dbRef = database;
      const currentMessage = await retryWithBackoff(async () => {
        return await writeQueue.enqueue(async () => {
          // Re-validate database inside callback
          let dbToUse = dbRef;
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
          return await validDb.getFirstAsync<{ server_id?: number; sync_status?: string }>(
            `SELECT server_id, sync_status FROM messages WHERE id = ?`,
            [message.id]
          );
        });
      });
      
      // ✅ If message has server_id, it's already saved - mark as synced and remove from pending/failed
      if (currentMessage?.server_id) {
        const updateSucceeded = await updateMessageStatus(message.id, currentMessage.server_id, 'synced');
        if (updateSucceeded) {
          console.log(`[MessageRetry] ✅ Message ${message.id} already has server_id ${currentMessage.server_id}, marked as synced`);
        } else {
          console.warn(`[MessageRetry] ⚠️ Failed to update message ${message.id} status (has server_id ${currentMessage.server_id})`);
        }
        messagesBeingRetried.delete(message.id);
        return;
      }
      
      // ✅ If message is already synced (but somehow got into pending list), skip it
      if (currentMessage?.sync_status === 'synced') {
        console.log(`[MessageRetry] Skipping message ${message.id} - already synced`);
        messagesBeingRetried.delete(message.id);
        return;
      }
    }
  } catch (checkError) {
    // Continue with retry if check fails
  }
  
  // Double-check: Skip if message already has server_id (already synced)
  if (message.server_id) {
    // Update status to synced
    const updateSucceeded = await updateMessageStatus(message.id, message.server_id, 'synced');
    if (updateSucceeded) {
      console.log(`[MessageRetry] ✅ Message ${message.id} already has server_id ${message.server_id}, marked as synced`);
    } else {
      console.warn(`[MessageRetry] ⚠️ Failed to update message ${message.id} status (has server_id ${message.server_id})`);
    }
    messagesBeingRetried.delete(message.id);
    return;
  }
  
  try {
    // Load attachments for this message
    let attachments: DatabaseAttachment[] = [];
    try {
      const database = await getDb();
      if (database) {
        // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
        const dbRef = database;
        attachments = await retryWithBackoff(async () => {
          return await writeQueue.enqueue(async () => {
            // Re-validate database inside callback
            let dbToUse = dbRef;
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
            return await validDb.getAllAsync<DatabaseAttachment>(
              `SELECT * FROM attachments WHERE message_id = ?`,
              [message.id]
            );
          });
        });
      }
    } catch (attachmentError) {
      // Continue without attachments if loading fails
    }
    
    // Reconstruct FormData from message
    const formData = new FormData();
    
    if (message.conversation_type === 'individual' && message.receiver_id) {
      formData.append('receiver_id', String(message.receiver_id));
    } else if (message.conversation_type === 'group' && message.group_id) {
      formData.append('group_id', String(message.group_id));
    }
    
    if (message.message) {
      formData.append('message', message.message);
    }
    
    if (message.reply_to_id) {
      formData.append('reply_to_id', String(message.reply_to_id));
    }
    
    // Add attachments if they exist
    if (attachments.length > 0) {
      for (const attachment of attachments) {
        if (attachment.local_path) {
          try {
            formData.append('attachments[]', {
              uri: attachment.local_path,
              name: attachment.name || 'attachment',
              type: attachment.mime || 'application/octet-stream',
            } as any);
          } catch (attachError) {
            // Continue with other attachments
          }
        } else if (attachment.url && !attachment.url.startsWith('http')) {
          try {
            formData.append('attachments[]', {
              uri: attachment.url,
              name: attachment.name || 'attachment',
              type: attachment.mime || 'application/octet-stream',
            } as any);
          } catch (attachError) {
            // Continue
          }
        }
      }
    }

    // STEP 1: Send message to API
    let sendSuccess = false;
    let sendError: any = null;
    
    try {
      const res = await messagesAPI.sendMessage(formData);
      
      // Check if status indicates success
      if (res.status >= 200 && res.status < 300) {
        sendSuccess = true;
        
        // ✅ CRITICAL FIX: Extract message ID directly from response (like handleSend does)
        // If API returns the message ID, we can update immediately without verification
        let messageIdFromResponse: number | undefined;
        let serverCreatedAtFromResponse: string | undefined;
        
        if (res.data) {
          if (res.data.id) {
            messageIdFromResponse = res.data.id;
            serverCreatedAtFromResponse = res.data.created_at;
          } else if (res.data.data?.id) {
            messageIdFromResponse = res.data.data.id;
            serverCreatedAtFromResponse = res.data.data.created_at;
          } else if (res.data.message?.id) {
            messageIdFromResponse = res.data.message.id;
            serverCreatedAtFromResponse = res.data.message.created_at;
          } else if (res.data.message_id) {
            messageIdFromResponse = res.data.message_id;
            serverCreatedAtFromResponse = res.data.created_at || res.data.message_created_at;
          } else if (res.data.result?.id) {
            messageIdFromResponse = res.data.result.id;
            serverCreatedAtFromResponse = res.data.result.created_at;
          }
        }
        
        // ✅ If we got the ID from response, update immediately and skip verification
        if (messageIdFromResponse) {
          console.log(`[MessageRetry] 💾 Updating message ${message.id} status to synced with server_id ${messageIdFromResponse} (from API response)`);
          const updateStartTime = Date.now();
          
          const updateSucceeded = await updateMessageStatus(
            message.id, 
            messageIdFromResponse, 
            'synced', 
            serverCreatedAtFromResponse
          );
          
          const updateDuration = Date.now() - updateStartTime;
          
          if (updateSucceeded) {
            console.log(`[MessageRetry] ✅ RETRY DATABASE UPDATE SUCCESS for message ${message.id} | server_id: ${messageIdFromResponse} | Duration: ${updateDuration}ms`);
            messagesBeingRetried.delete(message.id);
            return; // Success - exit function immediately
          } else {
            console.error(`[MessageRetry] ❌ RETRY DATABASE UPDATE FAILED for message ${message.id} | server_id: ${messageIdFromResponse} | Duration: ${updateDuration}ms | API saved it but local update failed`);
            // Message is saved on API but local update failed - cleanup will catch it later
            messagesBeingRetried.delete(message.id);
            return;
          }
        }
        
        // If no ID in response, continue with verification (existing logic below)
      } else {
        sendError = new Error(`API returned status ${res.status}`);
      }
    } catch (sendErr: any) {
      sendError = sendErr;
    }
    
    // STEP 2: ALWAYS verify by fetching from API (regardless of send response)
    // If message was sent successfully, it WILL be in the API database
    if (sendSuccess || (sendError?.response?.status >= 200 && sendError?.response?.status < 300)) {
      try {
        // ✅ INCREASED wait time for backend to process and index
        await new Promise(resolve => setTimeout(resolve, 3000)); // Increased from 2000ms to 3000ms
        
        // ✅ CRITICAL CHECK: First check if message was already saved by sync (has server_id now)
        try {
          const database = await getDb();
          if (database) {
            // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
            const dbRef = database;
            const updatedMessage = await retryWithBackoff(async () => {
              return await writeQueue.enqueue(async () => {
                // Re-validate database inside callback
                let dbToUse = dbRef;
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
                return await validDb.getFirstAsync<{ server_id?: number; sync_status?: string }>(
                  `SELECT server_id, sync_status FROM messages WHERE id = ?`,
                  [message.id]
                );
              });
            });
            
            if (updatedMessage?.server_id) {
              // ✅ Message was saved by sync! Update status to synced and remove from pending/failed
              const updateSucceeded = await updateMessageStatus(message.id, updatedMessage.server_id, 'synced');
              if (updateSucceeded) {
                console.log(`[MessageRetry] ✅ Message ${message.id} was saved by sync (server_id: ${updatedMessage.server_id}), marked as synced`);
              } else {
                console.warn(`[MessageRetry] ⚠️ Failed to update message ${message.id} status (sync saved it with server_id ${updatedMessage.server_id})`);
              }
              messagesBeingRetried.delete(message.id);
              return; // Success - exit function
            }
          }
        } catch (checkError) {
          // Continue with API verification if check fails
        }
        
        // Fetch recent messages from API to verify our message is there
        let verifyRes;
        if (message.conversation_type === 'individual' && message.receiver_id) {
          verifyRes = await messagesAPI.getByUser(message.receiver_id, 1, 50); // Increased from 20 to 50
        } else if (message.conversation_type === 'group' && message.group_id) {
          verifyRes = await messagesAPI.getByGroup(message.group_id, 1, 50); // Increased from 20 to 50
        } else {
          throw new Error('Cannot verify - missing conversation info');
        }
        
        const messagesData = verifyRes.data.messages?.data || verifyRes.data.messages || [];
        
        // ✅ IMPROVED MATCHING: More flexible matching logic
        const messageTime = new Date(message.created_at).getTime();
        const matchingMessage = messagesData.find((msg: any) => {
          const msgTime = new Date(msg.created_at).getTime();
          const timeDiff = Math.abs(msgTime - messageTime);
          
          // ✅ More flexible matching:
          // 1. Check by exact content match (within 5 minutes)
          // 2. Check by partial content match (within 10 minutes) 
          // 3. Check by sender + conversation (within 5 minutes) if content is similar
          const exactContentMatch = msg.message === message.message;
          const partialContentMatch = message.message && msg.message && 
            (msg.message.includes(message.message.substring(0, Math.min(30, message.message.length))) ||
             message.message.includes(msg.message.substring(0, Math.min(30, msg.message.length))));
          
          const senderMatch = msg.sender_id === message.sender_id;
          const conversationMatch = (message.conversation_type === 'individual' && msg.receiver_id === message.receiver_id) ||
                                    (message.conversation_type === 'group' && msg.group_id === message.group_id);
          
          // Match if:
          // - Exact content + within 5 minutes, OR
          // - Partial content + sender + conversation + within 10 minutes
          if (exactContentMatch && timeDiff < 300000) { // 5 minutes
            return true;
          }
          if (partialContentMatch && senderMatch && conversationMatch && timeDiff < 600000) { // 10 minutes
            return true;
          }
          
          return false;
        });
        
        if (matchingMessage?.id) {
          // ✅ SUCCESS! Message was saved to API DB
          // Update SQLite with server_id and mark as synced (removes from pending/failed)
          console.log(`[MessageRetry] 💾 Updating message ${message.id} status to synced with server_id ${matchingMessage.id} (from verification)`);
          const verifyUpdateStartTime = Date.now();
          
          const updateSucceeded = await updateMessageStatus(
            message.id, 
            matchingMessage.id, 
            'synced', 
            matchingMessage.created_at
          );
          
          const verifyUpdateDuration = Date.now() - verifyUpdateStartTime;
          
          if (updateSucceeded) {
            console.log(`[MessageRetry] ✅ RETRY VERIFICATION DATABASE UPDATE SUCCESS for message ${message.id} | server_id: ${matchingMessage.id} | Duration: ${verifyUpdateDuration}ms`);
          } else {
            console.error(`[MessageRetry] ❌ RETRY VERIFICATION DATABASE UPDATE FAILED for message ${message.id} | server_id: ${matchingMessage.id} | Duration: ${verifyUpdateDuration}ms`);
          }
          
          messagesBeingRetried.delete(message.id);
          return; // Success - exit function
        } else {
          // ❌ Message NOT found in API DB - check if sync might have saved it
          // ✅ FINAL CHECK: Check again if message was saved by sync (race condition)
          try {
            const database = await getDb();
            if (database) {
              // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
              const dbRef = database;
              const updatedMessage = await retryWithBackoff(async () => {
                return await writeQueue.enqueue(async () => {
                  // Re-validate database inside callback
                  let dbToUse = dbRef;
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
                  return await validDb.getFirstAsync<{ server_id?: number }>(
                    `SELECT server_id FROM messages WHERE id = ?`,
                    [message.id]
                  );
                });
              });
              
              if (updatedMessage?.server_id) {
                // ✅ Message was saved by sync! Update status to synced and remove from pending/failed
                await updateMessageStatus(message.id, updatedMessage.server_id, 'synced');
                console.log(`[MessageRetry] ✅ Message ${message.id} was saved by sync during verification (server_id: ${updatedMessage.server_id}), marked as synced`);
                messagesBeingRetried.delete(message.id);
                return;
              }
            }
          } catch (checkError) {
            // Continue with error handling
          }
          
          // Message still not found - log warning
          console.warn(`[MessageRetry] ⚠️ Message ${message.id} not found in API DB after send`);
          
          // Check if it was a network error (retryable) or API error
          if (!sendError || sendError.code === 'ECONNABORTED' || sendError.message === 'Network Error') {
            // Network error - keep as pending for retry
            messagesBeingRetried.delete(message.id);
            return; // Will retry later
          } else if (sendError?.response?.status >= 400 && sendError?.response?.status < 500) {
            // Client error (4xx) - likely permanent
            await updateMessageStatus(message.id, undefined, 'failed');
            console.warn(`[MessageRetry] ❌ Message ${message.id} marked as failed (4xx error)`);
            messagesBeingRetried.delete(message.id);
            return;
          } else {
            // Server error or unknown - keep as pending for retry
            messagesBeingRetried.delete(message.id);
            return;
          }
        }
      } catch (verifyError) {
        console.error(`[MessageRetry] ❌ Verification failed for message ${message.id}:`, verifyError);
        
        // ✅ CHECK: Before giving up, check if sync saved the message
        try {
          const database = await getDb();
          if (database) {
            // ✅ CRITICAL FIX: Put read operation through queue to prevent concurrent access
            const dbRef = database;
            const updatedMessage = await retryWithBackoff(async () => {
              return await writeQueue.enqueue(async () => {
                // Re-validate database inside callback
                let dbToUse = dbRef;
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
                return await validDb.getFirstAsync<{ server_id?: number }>(
                  `SELECT server_id FROM messages WHERE id = ?`,
                  [message.id]
                );
              });
            });
            
            if (updatedMessage?.server_id) {
              // ✅ Message was saved by sync! Update status to synced and remove from pending/failed
              const updateSucceeded = await updateMessageStatus(message.id, updatedMessage.server_id, 'synced');
              if (updateSucceeded) {
                console.log(`[MessageRetry] ✅ Message ${message.id} was saved by sync during verification error (server_id: ${updatedMessage.server_id}), marked as synced`);
              } else {
                console.warn(`[MessageRetry] ⚠️ Failed to update message ${message.id} status (sync saved it with server_id ${updatedMessage.server_id})`);
              }
              messagesBeingRetried.delete(message.id);
              return;
            }
          }
        } catch (checkError) {
          // Continue with normal error handling
        }
        
        // Verification query failed - can't confirm if message was saved
        // If send was successful, assume message was saved (optimistic)
        if (sendSuccess) {
          // Keep as pending - sync will pick it up later
          messagesBeingRetried.delete(message.id);
          return;
        } else {
          // Send failed AND verification failed - keep as pending for retry
          messagesBeingRetried.delete(message.id);
          return;
        }
      }
    } else {
      // Send failed (not 200-299) - don't verify, just retry later
      console.warn(`[MessageRetry] ⚠️ Send failed for message ${message.id}: ${sendError?.message || 'Unknown error'}`);
      
      // Check error type
      const isNetworkError = 
        sendError?.message === 'Network Error' || 
        !sendError?.response ||
        sendError?.code === 'ECONNABORTED' ||
        sendError?.message?.includes('timeout');
      
      if (!isNetworkError && sendError?.response?.status >= 400 && sendError?.response?.status < 500) {
        // Client error (4xx) - mark as failed
        await updateMessageStatus(message.id, undefined, 'failed');
        console.warn(`[MessageRetry] ❌ Message ${message.id} marked as failed (4xx error)`);
      }
      // Otherwise keep as pending for retry
      
      messagesBeingRetried.delete(message.id);
      return;
    }
  } catch (error: any) {
    // Unexpected error
    console.error(`[MessageRetry] Unexpected error retrying message ${message.id}:`, error);
    messagesBeingRetried.delete(message.id);
    // Keep as pending for retry
  }
}

/**
 * Schedule background retry based on app state
 */
function scheduleBackgroundRetry() {
  // Clear any existing timeout
  if (backgroundRetryTimeout) {
    clearTimeout(backgroundRetryTimeout);
  }
  
  // Schedule retry based on app state
  if (appState === 'background' || appState === 'inactive') {
    // When in background, retry less frequently (every 2 minutes)
    backgroundRetryTimeout = setTimeout(() => {
      retryPendingMessages().catch(error => {
        console.error('[MessageRetry] Background retry error:', error);
      });
      // Schedule next retry
      scheduleBackgroundRetry();
    }, 2 * 60 * 1000); // 2 minutes
  } else {
    // When active, retry more frequently (every 10 seconds)
    backgroundRetryTimeout = setTimeout(() => {
      retryPendingMessages().catch(error => {
        console.error('[MessageRetry] Active retry error:', error);
      });
      // Schedule next retry
      scheduleBackgroundRetry();
    }, 10000); // 10 seconds
  }
}

/**
 * Start automatic retry service with background/foreground handling
 */
export function startRetryService(intervalMs: number = 30000): void {
  if (retryInterval) {
    stopRetryService();
  }
  
  // Initialize app state
  appState = AppState.currentState;
  
  // Set up AppState listener for background/foreground handling
  if (appStateSubscription) {
    appStateSubscription.remove();
  }
  
  appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
    appState = nextAppState;
    
    if (nextAppState === 'active') {
      // App came to foreground - retry immediately
      retryPendingMessages().catch(error => {
        console.error('[MessageRetry] Foreground retry error:', error);
      });
      // Restart scheduling with active interval
      scheduleBackgroundRetry();
    } else {
      // App went to background - continue retrying but less frequently
      scheduleBackgroundRetry();
    }
  });
  
  // Initial delay before first retry to avoid immediate retries
  setTimeout(() => {
    // Start interval-based retry for active state
    retryInterval = setInterval(() => {
      if (appState === 'active') {
        retryPendingMessages().catch(error => {
          console.error('[MessageRetry] Error in retry service:', error);
        });
      }
    }, intervalMs);
    
    // Also run immediately after delay
    retryPendingMessages().catch(error => {
      console.error('[MessageRetry] Error in initial retry:', error);
    });
    
    // Start background retry scheduling
    scheduleBackgroundRetry();
  }, 2000); // 2 second delay before first retry
  
  if (__DEV__) {
    console.log(`[MessageRetry] Started global retry service (interval: ${intervalMs}ms, background: 2min, foreground: 10s)`);
  }
}

/**
 * Stop automatic retry service
 */
export function stopRetryService(): void {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
  if (backgroundRetryTimeout) {
    clearTimeout(backgroundRetryTimeout);
    backgroundRetryTimeout = null;
  }
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
  if (__DEV__) {
    console.log('[MessageRetry] Stopped retry service');
  }
}

/**
 * Manually trigger retry (useful for retry button)
 */
export async function retryFailedMessage(localMessageId: number): Promise<boolean> {
  try {
    const pendingMessages = await getPendingMessages();
    let message = pendingMessages.find(m => m.id === localMessageId);
    
    if (!message) {
      // Message might be marked as failed, change back to pending for retry
      const database = await import('./database').then(m => m.getDb());
      if (!database) return false;
      
      const db = await database;
      if (!db) return false;
      
      const failedMessage = await db.getFirstAsync<DatabaseMessage>(
        `SELECT * FROM messages WHERE id = ? AND sync_status = 'failed'`,
        [localMessageId]
      );
      
      if (!failedMessage) {
        return false;
      }
      
      // Change status back to pending for retry
      await updateMessageStatus(localMessageId, undefined, 'pending');
      message = failedMessage;
    }
    
    await retrySingleMessage(message);
    return true;
  } catch (error) {
    console.error(`[MessageRetry] Failed to retry message ${localMessageId}:`, error);
    return false;
  }
}



