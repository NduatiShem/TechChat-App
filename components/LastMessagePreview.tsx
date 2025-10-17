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
  
  // Check if this is a voice message (starts with 🎤)
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