import { usePendingShare } from '@/context/PendingShareContext';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect } from 'react';

type AttachmentSetter = (attachment: {
  uri: string;
  name: string;
  type: string;
  isImage?: boolean;
} | null) => void;

function applyPending(
  pendingAttachment: ReturnType<typeof usePendingShare>['pendingAttachment'],
  sharePickerVisible: boolean,
  setAttachment: AttachmentSetter,
  clearPendingAttachment: () => void
) {
  if (!pendingAttachment || sharePickerVisible) {
    return;
  }
  setAttachment(pendingAttachment);
  clearPendingAttachment();
}

/**
 * Fallback: attach shared file when opening a chat if the Send to… picker was dismissed without sending.
 */
export function useConsumePendingShareAttachment(setAttachment: AttachmentSetter) {
  const { pendingAttachment, clearPendingAttachment, sharePickerVisible } = usePendingShare();

  useEffect(() => {
    applyPending(pendingAttachment, sharePickerVisible, setAttachment, clearPendingAttachment);
  }, [pendingAttachment, sharePickerVisible, setAttachment, clearPendingAttachment]);

  useFocusEffect(
    useCallback(() => {
      applyPending(pendingAttachment, sharePickerVisible, setAttachment, clearPendingAttachment);
    }, [pendingAttachment, sharePickerVisible, setAttachment, clearPendingAttachment])
  );
}
