import React from 'react';
import { View, Text } from 'react-native';
import { useNotifications } from '@/context/NotificationContext';

interface NotificationBadgeProps {
  conversationId?: number;
  size?: 'small' | 'medium' | 'large';
}

export const NotificationBadge: React.FC<NotificationBadgeProps> = ({ 
  conversationId, 
  size = 'medium' 
}) => {
  const { unreadCount, conversationCounts } = useNotifications();
  
  const count = conversationId 
    ? conversationCounts[conversationId] || 0
    : unreadCount;

  if (count === 0) return null;

  const sizeClasses = {
    small: 'w-4 h-4',
    medium: 'w-5 h-5',
    large: 'w-6 h-6'
  };

  const textSizes = {
    small: 'text-xs',
    medium: 'text-xs',
    large: 'text-sm'
  };

  return (
    <View
      className={`${sizeClasses[size]} rounded-full bg-green-500 items-center justify-center absolute -top-1 -right-1`}
    >
      <Text className={`${textSizes[size]} text-white font-bold`}>
        {count > 99 ? '99+' : count.toString()}
      </Text>
    </View>
  );
}; 