import type { DatabaseAttachment, DatabaseMessage } from '@/types/database';
import { AppState, AppStateStatus } from 'react-native';
import { messagesAPI } from './api';
import { getDb, getPendingMessages, updateMessageStatus } from './database';

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

export async function retryPendingMessages(): Promise<void> {
  if (isRetrying) {
    return; // Already retrying
  }

  try {
    isRetrying = true;
    const pendingMessages = await getPendingMessages();
    
    if (pendingMessages.length === 0) {
      return;
    }

    if (__DEV__) {
      console.log(`[MessageRetry] Found ${pendingMessages.length} pending messages`);
    }

    // Filter out messages that are already being retried or have server_id (already synced)
    const messagesToRetry = pendingMessages.filter(msg => {
      // Skip if already has server_id (already synced)
      if (msg.server_id) {
        if (__DEV__) {
          console.log(`[MessageRetry] Skipping message ${msg.id} - already has server_id ${msg.server_id}`);
        }
        // Update status to synced if it has server_id but status is still pending
        updateMessageStatus(msg.id, msg.server_id, 'synced').catch(() => {});
        return false;
      }
      
      // Skip if currently being retried
      if (messagesBeingRetried.has(msg.id)) {
        if (__DEV__) {
          console.log(`[MessageRetry] Skipping message ${msg.id} - already being retried`);
        }
        return false;
      }
      
      return true;
    });
    
    if (messagesToRetry.length === 0) {
      return;
    }

    if (__DEV__) {
      console.log(`[MessageRetry] Retrying ${messagesToRetry.length} pending messages`);
    }

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
 * Retry sending a single message
 */
async function retrySingleMessage(message: DatabaseMessage): Promise<void> {
  // Double-check: Skip if message already has server_id (already synced)
  if (message.server_id) {
    if (__DEV__) {
      console.log(`[MessageRetry] Message ${message.id} already has server_id ${message.server_id}, skipping retry`);
    }
    // Update status to synced
    await updateMessageStatus(message.id, message.server_id, 'synced');
    messagesBeingRetried.delete(message.id);
    return;
  }
  
  // Check if already being retried (in-memory check)
  if (messagesBeingRetried.has(message.id)) {
    if (__DEV__) {
      console.log(`[MessageRetry] Message ${message.id} is already being retried, skipping duplicate`);
    }
    return;
  }
  
  try {
    
    // Load attachments for this message
    let attachments: DatabaseAttachment[] = [];
    try {
      const database = await getDb();
      if (database) {
        attachments = await database.getAllAsync<DatabaseAttachment>(
          `SELECT * FROM attachments WHERE message_id = ?`,
          [message.id]
        );
      }
    } catch (attachmentError) {
      if (__DEV__) {
        console.warn(`[MessageRetry] Error loading attachments for message ${message.id}:`, attachmentError);
      }
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
      // Note: We need the server_id of the reply_to message, not local ID
      // For now, we'll skip reply_to_id in retry if we don't have server_id
      // This could be improved by storing reply_to_server_id in the database
      // For simplicity, we'll try to use the reply_to_id as-is (assuming it's a server_id)
      formData.append('reply_to_id', String(message.reply_to_id));
    }
    
    // Add attachments if they exist
    if (attachments.length > 0) {
      for (const attachment of attachments) {
        // Check if attachment has a local_path (file on device)
        if (attachment.local_path) {
          try {
            // Determine MIME type and name
            const mimeType = attachment.mime || 'application/octet-stream';
            const fileName = attachment.name || 'attachment';
            
            formData.append('attachments[]', {
              uri: attachment.local_path,
              name: fileName,
              type: mimeType,
            } as any);
          } catch (attachError) {
            if (__DEV__) {
              console.warn(`[MessageRetry] Error adding attachment ${attachment.id} to FormData:`, attachError);
            }
            // Continue with other attachments
          }
        } else if (attachment.url && !attachment.url.startsWith('http')) {
          // Local file path in url field
          try {
            formData.append('attachments[]', {
              uri: attachment.url,
              name: attachment.name || 'attachment',
              type: attachment.mime || 'application/octet-stream',
            } as any);
          } catch (attachError) {
            if (__DEV__) {
              console.warn(`[MessageRetry] Error adding attachment ${attachment.id} to FormData:`, attachError);
            }
          }
        } else {
          // Attachment is already on server (has URL), skip it
          if (__DEV__) {
            console.log(`[MessageRetry] Skipping attachment ${attachment.id} - already on server (${attachment.url})`);
          }
        }
      }
    }

    // Send message
    const res = await messagesAPI.sendMessage(formData);
    
    // Handle different response structures
    let messageId: number | undefined;
    let serverCreatedAt: string | undefined;
    
    // Try different possible response structures
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
    
    if (messageId) {
      // Success - update message status WITH SERVER TIMESTAMP to prevent duplicates
      await updateMessageStatus(message.id, messageId, 'synced', serverCreatedAt);
      
      // Remove from retry set immediately
      messagesBeingRetried.delete(message.id);
      
      if (__DEV__) {
        console.log(`[MessageRetry] Successfully sent message ${message.id}, server_id: ${messageId}, timestamp: ${serverCreatedAt}`);
      }
    } else {
      // Log the actual response structure for debugging
      if (__DEV__) {
        console.warn(`[MessageRetry] No message ID in response for message ${message.id}. Response structure:`, {
          hasData: !!res.data,
          dataKeys: res.data ? Object.keys(res.data) : [],
          fullResponse: JSON.stringify(res.data, null, 2).substring(0, 500),
        });
      }
      
      // If response is successful (status 200-299) but no ID, assume it was sent
      // This handles cases where the API might not return the ID but the message was sent
      if (res.status >= 200 && res.status < 300) {
        if (__DEV__) {
          console.log(`[MessageRetry] Response successful but no ID. Keeping message ${message.id} as pending for manual verification.`);
        }
        // Keep as pending - it might have been sent but we can't verify
        // The next sync will pick it up if it was actually sent
        // Remove from retry set to prevent immediate re-retry
        messagesBeingRetried.delete(message.id);
        return; // Don't throw error, just return
      } else {
        // Reset to pending on error
        messagesBeingRetried.delete(message.id);
        throw new Error(`No message ID in response. Status: ${res.status}`);
      }
    }
  } catch (error: any) {
    // Log the error for debugging
    if (__DEV__) {
      console.error(`[MessageRetry] Error retrying message ${message.id}:`, {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        code: error.code,
      });
    }
    
    // Check if it's a network error (retryable) or a permanent error
    const isNetworkError = 
      error.message === 'Network Error' || 
      !error.response ||
      error.code === 'ECONNABORTED' ||
      error.message?.includes('timeout') ||
      error.message?.includes('No message ID in response');
    
    // Check if it's a "no ID" error but response was successful
    const isNoIdButSuccess = 
      error.message?.includes('No message ID in response') &&
      error.response?.status >= 200 &&
      error.response?.status < 300;
    
    // Remove from retry set on error
    messagesBeingRetried.delete(message.id);
    
    if (isNoIdButSuccess) {
      // Response was successful but no ID - keep as pending, will be picked up by sync
      if (__DEV__) {
        console.log(`[MessageRetry] Message ${message.id} may have been sent (success status but no ID). Keeping as pending.`);
      }
      // Don't mark as failed, keep as pending for sync to verify
      return; // Don't throw, allow other messages to retry
    }
    
    if (!isNetworkError && error.response?.status >= 400 && error.response?.status < 500) {
      // Client error (4xx) - likely permanent, mark as failed
      await updateMessageStatus(message.id, undefined, 'failed');
      if (__DEV__) {
        console.warn(`[MessageRetry] Permanent error for message ${message.id}, marking as failed`);
      }
      // Don't throw - allow other messages to retry
    } else if (isNetworkError) {
      // Network error - keep as pending for next retry
      if (__DEV__) {
        console.warn(`[MessageRetry] Network error for message ${message.id}, will retry later`);
      }
      // Don't throw - allow other messages to retry
    } else {
      // Server error (5xx) - keep as pending for retry
      if (__DEV__) {
        console.warn(`[MessageRetry] Server error for message ${message.id}, will retry later`);
      }
      // Don't throw - allow other messages to retry
    }
    
    // Only throw if it's a critical error that should stop the retry loop
    // For most errors, we've handled them above and don't need to throw
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



