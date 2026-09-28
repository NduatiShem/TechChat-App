import GroupAvatar from '@/components/GroupAvatar';
import UserAvatar from '@/components/UserAvatar';
import { useAuth } from '@/context/AuthContext';
import { usePendingShare } from '@/context/PendingShareContext';
import { useTheme } from '@/context/ThemeContext';
import { deliverSharedAttachment } from '@/services/shareDeliveryService';
import { loadShareRecipients, searchShareRecipients } from '@/services/shareRecipientsService';
import type { ShareRecipient } from '@/types/shareRecipient';
import { getCachedAuthUserId } from '@/utils/cachedAuthUser';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function ShareToModal() {
  const { isAuthenticated, user } = useAuth();
  const { currentTheme } = useTheme();
  const { pendingAttachment, sharePickerVisible, closeSharePicker } = usePendingShare();
  const isDark = currentTheme === 'dark';

  const [recipients, setRecipients] = useState<ShareRecipient[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const visible = sharePickerVisible && !!pendingAttachment && isAuthenticated;

  useEffect(() => {
    if (!visible) {
      setSearchQuery('');
      setSelectedKeys(new Set());
      return;
    }

    let cancelled = false;
    setLoading(true);
    loadShareRecipients()
      .then((list) => {
        if (!cancelled) setRecipients(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    const timer = setTimeout(() => {
      searchShareRecipients(searchQuery).then(setRecipients);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, visible]);

  const selectedCount = selectedKeys.size;

  const headerAttachmentLabel = useMemo(() => {
    if (!pendingAttachment) return '';
    return pendingAttachment.name || 'Attachment';
  }, [pendingAttachment]);

  const toggleRecipient = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSend = async () => {
    if (!pendingAttachment || selectedCount === 0 || sending) return;

    setSending(true);
    try {
      let senderId = Number(user?.id ?? 0);
      if (!senderId) {
        senderId = (await getCachedAuthUserId()) ?? 0;
      }
      if (!senderId) {
        Alert.alert('Error', 'Please log in again to send.');
        return;
      }

      const selected = recipients.filter((r) => selectedKeys.has(r.key));
      const { sent, failed } = await deliverSharedAttachment(
        pendingAttachment,
        selected,
        senderId
      );

      closeSharePicker();

      if (failed === 0) {
        Alert.alert(
          'Sent',
          sent === 1
            ? 'Your file was sent to 1 chat.'
            : `Your file was sent to ${sent} chats.`
        );
      } else {
        Alert.alert(
          'Partially sent',
          `Sent to ${sent} chat(s). ${failed} could not be sent — try again from the chat.`
        );
      }
    } catch (error) {
      console.warn('[ShareToModal] send failed', error);
      Alert.alert('Error', 'Could not send your file. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const renderRow = ({ item }: { item: ShareRecipient }) => {
    const selected = selectedKeys.has(item.key);
    return (
      <TouchableOpacity
        onPress={() => toggleRecipient(item.key)}
        className={`flex-row items-center px-4 py-3 border-b ${
          isDark ? 'border-gray-700' : 'border-gray-200'
        }`}
        activeOpacity={0.7}
      >
        {item.type === 'group' ? (
          <GroupAvatar name={item.name} avatarUrl={item.avatarUrl} size={44} />
        ) : (
          <UserAvatar avatarUrl={item.avatarUrl} name={item.name} size={44} />
        )}
        <View className="flex-1 ml-3">
          <Text
            className={`text-base font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          {item.subtitle ? (
            <Text
              className={`text-sm mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
              numberOfLines={1}
            >
              {item.subtitle}
            </Text>
          ) : null}
        </View>
        <View
          className={`w-6 h-6 rounded-full border-2 items-center justify-center ${
            selected
              ? 'bg-[#283891] border-[#283891]'
              : isDark
                ? 'border-gray-500'
                : 'border-gray-400'
          }`}
        >
          {selected ? (
            <MaterialCommunityIcons name="check" size={16} color="#FFFFFF" />
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeSharePicker}>
      <SafeAreaView className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
        <View
          className={`flex-row items-center px-2 py-2 border-b ${
            isDark ? 'border-gray-700' : 'border-gray-200'
          }`}
        >
          <TouchableOpacity onPress={closeSharePicker} className="p-2" accessibilityLabel="Close">
            <MaterialCommunityIcons
              name="close"
              size={26}
              color={isDark ? '#FFFFFF' : '#111827'}
            />
          </TouchableOpacity>
          <View className="flex-1 ml-1">
            <Text className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Send to…
            </Text>
            <Text
              className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
              numberOfLines={1}
            >
              {headerAttachmentLabel}
            </Text>
          </View>
          {selectedCount > 0 ? (
            <TouchableOpacity
              onPress={handleSend}
              disabled={sending}
              className="bg-[#283891] px-4 py-2 rounded-full mr-2 flex-row items-center"
            >
              {sending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <MaterialCommunityIcons name="send" size={18} color="#FFFFFF" />
                  <Text className="text-white font-semibold ml-1">{selectedCount}</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
        </View>

        <View className={`px-4 py-3 ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
          <View
            className={`flex-row items-center rounded-xl px-3 py-2 ${
              isDark ? 'bg-gray-700' : 'bg-white'
            }`}
          >
            <MaterialCommunityIcons
              name="magnify"
              size={22}
              color={isDark ? '#9CA3AF' : '#6B7280'}
            />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search users and groups"
              placeholderTextColor={isDark ? '#9CA3AF' : '#9CA3AF'}
              className={`flex-1 ml-2 text-base ${isDark ? 'text-white' : 'text-gray-900'}`}
            />
          </View>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#283891" />
          </View>
        ) : (
          <FlatList
            data={recipients}
            keyExtractor={(item) => item.key}
            renderItem={renderRow}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View className="p-8 items-center">
                <Text className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                  No contacts found. Start a chat first, or search by name.
                </Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
