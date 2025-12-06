import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';

interface MessageStatusProps {
  readAt?: string | null | undefined;
  syncStatus?: 'synced' | 'pending' | 'failed';
  isDark?: boolean;
  size?: number;
}

/**
 * WhatsApp-style read receipt component
 * - Single gray tick (✓): Message saved to SQLite (pending)
 * - Double gray ticks (✓✓): Message synced with API (sent/delivered)
 * - Double blue ticks (✓✓): Message read by receiver
 */
export default function MessageStatus({ 
  readAt, 
  syncStatus = 'synced',
  isDark = false,
  size = 14 
}: MessageStatusProps) {
  const isRead = readAt !== null && readAt !== undefined;
  const isPending = syncStatus === 'pending';
  const isSynced = syncStatus === 'synced';
  
  // Determine tick color and count
  let tickColor: string;
  let showSingleTick = false;
  
  if (isRead) {
    // Double blue ticks - message read
    tickColor = '#34B7F1'; // WhatsApp blue
    showSingleTick = false;
  } else if (isPending) {
    // Single gray tick - message pending (saved to SQLite but not synced)
    tickColor = isDark ? '#9CA3AF' : '#6B7280'; // Gray
    showSingleTick = true;
  } else if (isSynced) {
    // Double gray ticks - message synced (sent/delivered but not read)
    tickColor = isDark ? '#9CA3AF' : '#6B7280'; // Gray
    showSingleTick = false;
  } else {
    // Failed state - show single gray tick (same as pending)
    tickColor = isDark ? '#9CA3AF' : '#6B7280'; // Gray
    showSingleTick = true;
  }
  
  return (
    <View style={styles.container}>
      {/* First tick - always show */}
      <MaterialCommunityIcons 
        name="check" 
        size={size} 
        color={tickColor}
        style={styles.tick}
      />
      {/* Second tick - only show if synced or read (not pending) */}
      {!showSingleTick && (
        <MaterialCommunityIcons 
          name="check" 
          size={size} 
          color={tickColor}
          style={[styles.tick, styles.secondTick]}
        />
      )}
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

