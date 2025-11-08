import { useTheme } from '@/context/ThemeContext';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

interface ReplyPreviewProps {
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
  onCancel: () => void;
}

export default function ReplyPreview({ replyTo, onCancel }: ReplyPreviewProps) {
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

  return (
    <View style={{
      backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0',
      borderLeftWidth: 4,
      borderLeftColor: '#007AFF',
      padding: 12,
      marginHorizontal: 16,
      marginBottom: 0,
      borderRadius: 8,
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={{
            color: '#007AFF',
            fontSize: 12,
            fontWeight: '600',
            marginBottom: 4,
          }}>
            Replying to {replyTo.sender.name || 'Unknown User'}
          </Text>
          <Text style={{
            color: isDark ? '#ffffff' : '#000000',
            fontSize: 14,
            opacity: 0.8,
          }} numberOfLines={2}>
            {getPreviewText()}
          </Text>
        </View>
        <TouchableOpacity onPress={onCancel} style={{ marginLeft: 8 }}>
          <MaterialIcons 
            name="close" 
            size={20} 
            color={isDark ? '#ffffff' : '#000000'} 
          />
        </TouchableOpacity>
      </View>
    </View>
  );
} 