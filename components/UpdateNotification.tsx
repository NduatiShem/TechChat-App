import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';

interface UpdateNotificationProps {
  updateAvailable: boolean;
  onApplyUpdate: () => void;
  onDismiss?: () => void;
}

/**
 * Non-intrusive update notification banner
 * Shows when an update is available and allows user to apply it
 */
export function UpdateNotification({ 
  updateAvailable, 
  onApplyUpdate,
  onDismiss 
}: UpdateNotificationProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === 'dark';

  if (!updateAvailable) {
    return null;
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? '#1F2937' : '#F3F4F6',
          borderBottomColor: isDark ? '#374151' : '#E5E7EB',
        },
      ]}
    >
      <View style={styles.content}>
        <MaterialCommunityIcons
          name="download"
          size={20}
          color={isDark ? '#10B981' : '#059669'}
          style={styles.icon}
        />
        <View style={styles.textContainer}>
          <Text
            style={[
              styles.title,
              { color: isDark ? '#FFFFFF' : '#111827' },
            ]}
          >
            Update Available
          </Text>
          <Text
            style={[
              styles.message,
              { color: isDark ? '#9CA3AF' : '#6B7280' },
            ]}
          >
            A new version is ready. Restart to apply.
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity
          onPress={onApplyUpdate}
          style={[
            styles.button,
            styles.applyButton,
            { backgroundColor: '#10B981' },
          ]}
        >
          <Text style={styles.buttonText}>Restart</Text>
        </TouchableOpacity>
        {onDismiss && (
          <TouchableOpacity
            onPress={onDismiss}
            style={[
              styles.button,
              styles.dismissButton,
              {
                backgroundColor: isDark ? '#374151' : '#E5E7EB',
              },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                { color: isDark ? '#9CA3AF' : '#6B7280' },
              ]}
            >
              Later
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    zIndex: 1000,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  icon: {
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  message: {
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  applyButton: {
    // backgroundColor set inline
  },
  dismissButton: {
    // backgroundColor set inline
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});



