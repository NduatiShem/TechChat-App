import { useTheme } from '@/context/ThemeContext';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

interface ReplyBubbleProps {
  replyTo: {
    id: number;
    message: string;
    sender: {
      id: number;
      name: string;
    };
    attachments?: {
      id: number;
      name: string;
      mime: string;
      url: string;
    }[];
  };
  isMyMessage: boolean;
  onPress?: () => void;
}

export default function ReplyBubble({ replyTo, isMyMessage, onPress }: ReplyBubbleProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === 'dark';

  const hasImageAttachment = replyTo.attachments?.some(att => att.mime.startsWith('image/'));
  const hasAudioAttachment = replyTo.attachments?.some(att => att.mime.startsWith('audio/'));
  const hasOtherAttachment = replyTo.attachments?.some(att => !att.mime.startsWith('image/') && !att.mime.startsWith('audio/'));

  const getPreviewText = () => {
    if (hasAudioAttachment) {
      return '🎤 Voice message';
    }
    if (hasImageAttachment) {
      return '📷 Image';
    }
    if (hasOtherAttachment) {
      return '📎 File';
    }
    return replyTo.message || 'Empty message';
  };

  const replyBubbleStyle = {
    backgroundColor: isMyMessage 
      ? (isDark ? '#1a1a1a' : '#e0e0e0')
      : (isDark ? '#3a3a3a' : '#f5f5f5'),
    borderLeftWidth: 3,
    borderLeftColor: isMyMessage ? '#007AFF' : '#34C759',
    padding: 8,
    marginBottom: 8,
    borderRadius: 6,
    opacity: 0.8,
  };

  const senderTextStyle = {
    color: isMyMessage ? '#007AFF' : '#34C759',
    fontSize: 11,
    fontWeight: '600' as const,
    marginBottom: 2,
  };

  const messageTextStyle = {
    color: isDark ? '#ffffff' : '#000000',
    fontSize: 12,
    opacity: 0.9,
  };

  const Component = onPress ? TouchableOpacity : View;

  return (
    <Component 
      style={replyBubbleStyle}
      onPress={onPress}
      disabled={!onPress}
    >
      <Text style={senderTextStyle}>
        {replyTo.sender.name || 'Unknown User'}
      </Text>
      <Text style={messageTextStyle} numberOfLines={1}>
        {getPreviewText()}
      </Text>
    </Component>
  );
} 