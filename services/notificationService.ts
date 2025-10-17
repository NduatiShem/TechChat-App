import { useNotifications } from '@/context/NotificationContext';
import * as Notifications from 'expo-notifications';

export class NotificationService {
  private static instance: NotificationService;
  private notificationContext: any;

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  setNotificationContext(context: any) {
    this.notificationContext = context;
  }

  // Handle new message received
  async handleNewMessage(message: any, conversation: any) {
    if (!this.notificationContext) return;

    const { updateUnreadCount, scheduleLocalNotification } = this.notificationContext;

    // Update unread count for this conversation
    const currentCount = this.notificationContext.conversationCounts[conversation.id] || 0;
    updateUnreadCount(conversation.id, currentCount + 1);

    // Show local notification with updated badge count
    const title = conversation.is_group ? conversation.name : conversation.name;
    const body = message.message || 'New message';
    
    await scheduleLocalNotification(title, body, {
      conversationId: conversation.id,
      messageId: message.id,
      type: conversation.is_group ? 'group' : 'user'
    });
  }

  // Mark conversation as read
  markConversationAsRead(conversationId: number) {
    if (!this.notificationContext) return;
    
    this.notificationContext.resetUnreadCount(conversationId);
  }

  // Get current unread count for a conversation
  getConversationUnreadCount(conversationId: number): number {
    if (!this.notificationContext) return 0;
    
    return this.notificationContext.conversationCounts[conversationId] || 0;
  }

  // Get total unread count
  getTotalUnreadCount(): number {
    if (!this.notificationContext) return 0;
    
    return this.notificationContext.unreadCount;
  }

  // Clear all notifications
  clearAllNotifications() {
    if (!this.notificationContext) return;
    
    this.notificationContext.resetAllCounts();
    Notifications.dismissAllNotificationsAsync();
  }

  // Set app badge count
  async setBadgeCount(count: number) {
    await Notifications.setBadgeCountAsync(count);
  }
}

// Export singleton instance
export const notificationService = NotificationService.getInstance(); 