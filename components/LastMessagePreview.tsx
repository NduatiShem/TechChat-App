import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface LastMessagePreviewProps {
  message: string;
  isDark?: boolean;
  maxLength?: number;
}

export default function LastMessagePreview({ 
  message, 
  isDark = false, 
  maxLength = 50 
}: LastMessagePreviewProps) {
  //console.log('LastMessagePreview render:', { message, isDark, maxLength });
  
  // Check if this is a voice message (starts with 🎤 or [VOICE_MESSAGE:])
  if (message.startsWith('🎤 ')) {
    const duration = message.substring(2); // Remove the 🎤 and space
    //console.log('Rendering voice message with duration:', duration);
    
    return (
      <View style={styles.container}>
        <View style={styles.iconContainer}>
          <MaterialCommunityIcons 
            name="microphone" 
            size={16} 
            color={isDark ? '#39B54A' : '#6B7280'} 
          />
        </View>
        <Text style={[
          styles.durationText,
          { color: isDark ? '#39B54A' : '#6B7280' }
        ]}>
          {duration}
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
        <View style={styles.iconContainer}>
          <MaterialCommunityIcons 
            name="microphone" 
            size={16} 
            color={isDark ? '#39B54A' : '#6B7280'} 
          />
        </View>
        <Text style={[
          styles.durationText,
          { color: isDark ? '#39B54A' : '#6B7280' }
        ]}>
          Voice message ({formattedDuration})
        </Text>
      </View>
    );
  }
  
  // Regular text message - truncate if too long
  const truncatedMessage = message.length > maxLength 
    ? message.substring(0, maxLength) + '...'
    : message;
  
  //console.log('Rendering text message:', truncatedMessage);
  
  return (
    <Text 
      style={[
        styles.messageText,
        { color: isDark ? '#D1D5DB' : '#4B5563' }
      ]}
      numberOfLines={1}
    >
      {truncatedMessage}
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
  messageText: {
    fontSize: 14,
  },
}); 