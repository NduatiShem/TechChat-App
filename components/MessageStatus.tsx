import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';

interface MessageStatusProps {
  readAt: string | null | undefined;
  isDark?: boolean;
  size?: number;
}

/**
 * WhatsApp-style read receipt component
 * - One gray tick: Message sent (read_at is null)
 * - Two blue ticks: Message read (read_at is not null)
 */
export default function MessageStatus({ 
  readAt, 
  isDark = false,
  size = 14 
}: MessageStatusProps) {
  const isRead = readAt !== null && readAt !== undefined;
  
  // Color: blue if read, gray if not read
  const tickColor = isRead ? '#34B7F1' : (isDark ? '#9CA3AF' : '#6B7280');
  
  return (
    <View style={styles.container}>
      {/* First tick */}
      <MaterialCommunityIcons 
        name="check" 
        size={size} 
        color={tickColor}
        style={styles.tick}
      />
      {/* Second tick (slightly offset to the right) */}
      <MaterialCommunityIcons 
        name="check" 
        size={size} 
        color={tickColor}
        style={[styles.tick, styles.secondTick]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
  },
  tick: {
    marginLeft: -4, // Overlap ticks slightly
  },
  secondTick: {
    marginLeft: -8, // More overlap for WhatsApp-style look
  },
});

