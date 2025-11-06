import { useNotifications } from '@/context/NotificationContext';
import React from 'react';
import { Text, View } from 'react-native';

interface NotificationBadgeProps {
  conversationId?: number;
  count?: number; // Direct count override (for groups tab)
  size?: 'small' | 'medium' | 'large';
}

export const NotificationBadge: React.FC<NotificationBadgeProps> = ({ 
  conversationId,
  count: directCount,
  size = 'medium' 
}) => {
  const { unreadCount, conversationCounts } = useNotifications();
  
  // Use direct count if provided, otherwise calculate from context
  const count = directCount !== undefined
    ? directCount
    : conversationId 
      ? conversationCounts[conversationId] || 0
      : unreadCount;

  if (count === 0) return null;

  const badgeSizes = {
    small: 16,
    medium: 20,
    large: 24
  };

  const textSizes = {
    small: 10,
    medium: 11,
    large: 12
  };

  const badgeSize = badgeSizes[size];
  const textSize = textSizes[size];

  return (
    <View
      style={{
        position: 'absolute',
        top: -4,
        right: -4,
        minWidth: badgeSize,
        height: badgeSize,
        borderRadius: badgeSize / 2,
        backgroundColor: '#10B981',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: count > 99 ? 4 : 0,
      }}
    >
      <Text style={{
        fontSize: textSize,
        color: '#FFFFFF',
        fontWeight: 'bold',
      }}>
        {count > 99 ? '99+' : count.toString()}
      </Text>
    </View>
  );
}; 