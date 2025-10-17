import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export class BadgeService {
  private static instance: BadgeService;
  private currentBadgeCount: number = 0;

  private constructor() {}

  static getInstance(): BadgeService {
    if (!BadgeService.instance) {
      BadgeService.instance = new BadgeService();
    }
    return BadgeService.instance;
  }

  /**
   * Set the app badge count
   */
  async setBadgeCount(count: number): Promise<void> {
    try {
      this.currentBadgeCount = count;
      
      // Update notification badge
      await Notifications.setBadgeCountAsync(count);
      
      console.log(`Badge count updated to: ${count}`);
    } catch (error) {
      console.error('Failed to set badge count:', error);
    }
  }

  /**
   * Increment badge count
   */
  async incrementBadge(): Promise<void> {
    await this.setBadgeCount(this.currentBadgeCount + 1);
  }

  /**
   * Decrement badge count
   */
  async decrementBadge(): Promise<void> {
    const newCount = Math.max(0, this.currentBadgeCount - 1);
    await this.setBadgeCount(newCount);
  }

  /**
   * Clear badge count
   */
  async clearBadge(): Promise<void> {
    await this.setBadgeCount(0);
  }

  /**
   * Get current badge count
   */
  getCurrentBadgeCount(): number {
    return this.currentBadgeCount;
  }

  /**
   * Handle notification received - update badge
   */
  async handleNotificationReceived(notification: any): Promise<void> {
    // Extract badge count from notification data
    const badgeCount = notification.request.content.data?.badge;
    if (badgeCount) {
      await this.setBadgeCount(parseInt(badgeCount));
    } else {
      // Increment badge if no specific count provided
      await this.incrementBadge();
    }
  }

  /**
   * Handle notification response (user tapped notification)
   */
  async handleNotificationResponse(response: any): Promise<void> {
    // Clear badge when user opens the app via notification
    await this.clearBadge();
  }
}

// Export singleton instance
export const badgeService = BadgeService.getInstance(); 