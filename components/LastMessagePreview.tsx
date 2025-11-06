import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MessageStatus from './MessageStatus';

interface LastMessagePreviewProps {
  message: string;
  isDark?: boolean;
  maxLength?: number;
  attachments?: Array<{
    id: number;
    name: string;
    mime: string;
    url: string;
  }>;
  isFromMe?: boolean; // Whether this message is from the current user
  readAt?: string | null; // Read receipt timestamp
}

export default function LastMessagePreview({ 
  message, 
  isDark = false, 
  maxLength = 50,
  attachments = [],
  isFromMe = false,
  readAt = null
}: LastMessagePreviewProps) {
  
  // Check if there are attachments
  if (attachments && attachments.length > 0) {
    const firstAttachment = attachments[0];
    
    // Check if it's an image
    if (firstAttachment.mime?.startsWith('image/')) {
      return (
        <View style={styles.container}>
          {/* Show read receipt on the LEFT if message is from us */}
          {isFromMe && (
            <MessageStatus 
              readAt={readAt} 
              isDark={isDark}
              size={12}
            />
          )}
          <MaterialCommunityIcons 
            name="image" 
            size={16} 
            color={isDark ? '#39B54A' : '#6B7280'} 
          />
          <Text style={[
            styles.attachmentText,
            { color: isDark ? '#39B54A' : '#6B7280' }
          ]}>
            Photo
          </Text>
        </View>
      );
    }
    
    // Check if it's a file (not image)
    const fileName = firstAttachment.name || 'File';
    
    return (
      <View style={styles.container}>
        {/* Show read receipt on the LEFT if message is from us */}
        {isFromMe && (
          <MessageStatus 
            readAt={readAt} 
            isDark={isDark}
            size={12}
          />
        )}
        <MaterialCommunityIcons 
          name="file-document" 
          size={16} 
          color={isDark ? '#39B54A' : '#6B7280'} 
        />
        <Text style={[
          styles.attachmentText,
          { color: isDark ? '#39B54A' : '#6B7280' }
        ]}>
          {fileName}
        </Text>
      </View>
    );
  }
  
  // Check if this is a voice message (starts with 🎤 or [VOICE_MESSAGE:])
  if (message.startsWith('🎤 ')) {
    const duration = message.substring(2); // Remove the 🎤 and space
    //console.log('Rendering voice message with duration:', duration);
    
    return (
      <View style={styles.container}>
        {/* Show read receipt on the LEFT if message is from us */}
        {isFromMe && (
          <MessageStatus 
            readAt={readAt} 
            isDark={isDark}
            size={12}
          />
        )}
        <MaterialCommunityIcons 
          name="microphone" 
          size={16} 
          color={isDark ? '#39B54A' : '#6B7280'} 
        />
        <Text style={[
          styles.attachmentText,
          { color: isDark ? '#39B54A' : '#6B7280' }
        ]}>
          Voice message ({duration})
        </Text>
      </View>
    );
  }
  
  // Check if this is a voice message in [VOICE_MESSAGE:duration] format
  const voiceMatch = message.match(/^\[VOICE_MESSAGE:(\d+)\]$/);
  if (voiceMatch) {
    const duration = parseInt(voiceMatch[1]);
    const formattedDuration = duration < 60 ? `${duration}s` : `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}`;
    
    return (
      <View style={styles.container}>
        {/* Show read receipt on the LEFT if message is from us */}
        {isFromMe && (
          <MessageStatus 
            readAt={readAt} 
            isDark={isDark}
            size={12}
          />
        )}
        <MaterialCommunityIcons 
          name="microphone" 
          size={16} 
          color={isDark ? '#39B54A' : '#6B7280'} 
        />
        <Text style={[
          styles.attachmentText,
          { color: isDark ? '#39B54A' : '#6B7280' }
        ]}>
          Voice message ({formattedDuration})
        </Text>
      </View>
    );
  }
  
  // Check if this is an image message in [IMAGE] format (similar to voice messages)
  // Matches [IMAGE] at the end, optionally with text before it
  const imageMatch = message && message.match(/\s*\[IMAGE\]$/);
  if (imageMatch) {
    return (
      <View style={styles.container}>
        {/* Show read receipt on the LEFT if message is from us */}
        {isFromMe && (
          <MessageStatus 
            readAt={readAt} 
            isDark={isDark}
            size={12}
          />
        )}
        <MaterialCommunityIcons 
          name="image" 
          size={16} 
          color={isDark ? '#39B54A' : '#6B7280'} 
        />
        <Text style={[
          styles.attachmentText,
          { color: isDark ? '#39B54A' : '#6B7280' }
        ]}>
          Photo
        </Text>
      </View>
    );
  }
  
  // Check if this is a file message in [FILE] format (similar to voice messages)
  // Matches [FILE] at the end, optionally with text before it
  const fileMatch = message && message.match(/\s*\[FILE\]$/);
  if (fileMatch) {
    return (
      <View style={styles.container}>
        {/* Show read receipt on the LEFT if message is from us */}
        {isFromMe && (
          <MessageStatus 
            readAt={readAt} 
            isDark={isDark}
            size={12}
          />
        )}
        <MaterialCommunityIcons 
          name="file-document" 
          size={16} 
          color={isDark ? '#39B54A' : '#6B7280'} 
        />
        <Text style={[
          styles.attachmentText,
          { color: isDark ? '#39B54A' : '#6B7280' }
        ]}>
          File
        </Text>
      </View>
    );
  }
  
  // Check if message contains attachment indicators (fallback for when backend doesn't send attachment data)
  if (message && (message.includes('[IMAGE]') || message.includes('[FILE]') || message.includes('[ATTACHMENT]'))) {
    if (message.includes('[IMAGE]')) {
      return (
        <View style={styles.container}>
          {/* Show read receipt on the LEFT if message is from us */}
          {isFromMe && (
            <MessageStatus 
              readAt={readAt} 
              isDark={isDark}
              size={12}
            />
          )}
          <MaterialCommunityIcons 
            name="image" 
            size={16} 
            color={isDark ? '#39B54A' : '#6B7280'} 
          />
          <Text style={[
            styles.attachmentText,
            { color: isDark ? '#39B54A' : '#6B7280' }
          ]}>
            Photo
          </Text>
        </View>
      );
    }
    
    if (message.includes('[FILE]') || message.includes('[ATTACHMENT]')) {
      return (
        <View style={styles.container}>
          {/* Show read receipt on the LEFT if message is from us */}
          {isFromMe && (
            <MessageStatus 
              readAt={readAt} 
              isDark={isDark}
              size={12}
            />
          )}
          <MaterialCommunityIcons 
            name="file-document" 
            size={16} 
            color={isDark ? '#39B54A' : '#6B7280'} 
          />
          <Text style={[
            styles.attachmentText,
            { color: isDark ? '#39B54A' : '#6B7280' }
          ]}>
            File
          </Text>
        </View>
      );
    }
  }
  
  // Regular text message - truncate if too long
  const truncatedMessage = message && message.length > maxLength 
    ? message.substring(0, maxLength) + '...'
    : message;
  
  //console.log('Rendering text message:', truncatedMessage);
  
  // If message is from us, show read receipt on the LEFT
  if (isFromMe) {
    return (
      <View style={styles.messageContainer}>
        {/* Show read receipt on the LEFT, before the message */}
        <MessageStatus 
          readAt={readAt} 
          isDark={isDark}
          size={12}
        />
        <Text 
          style={[
            styles.messageText,
            { color: isDark ? '#D1D5DB' : '#4B5563' }
          ]}
          numberOfLines={1}
        >
          {truncatedMessage || 'No message'}
        </Text>
      </View>
    );
  }
  
  return (
    <Text 
      style={[
        styles.messageText,
        { color: isDark ? '#D1D5DB' : '#4B5563' }
      ]}
      numberOfLines={1}
    >
      {truncatedMessage || 'No message'}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconContainer: {
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  durationText: {
    fontSize: 14,
    fontWeight: '500',
  },
  attachmentText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  messageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  messageText: {
    fontSize: 14,
  },
}); 