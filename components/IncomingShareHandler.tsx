import { useAuth } from '@/context/AuthContext';
import { usePendingShare } from '@/context/PendingShareContext';
import { useIncomingShare } from '@/hooks/useIncomingShare';
import { useEffect, useRef } from 'react';

/** Keeps share listening active for the whole app session (including auth loading). */
export function IncomingShareHandler() {
  const { isAuthenticated } = useAuth();
  const { pendingAttachment, openSharePicker, sharePickerVisible } = usePendingShare();
  const openedQueuedShareRef = useRef(false);

  useIncomingShare({ enabled: true, showPicker: isAuthenticated });

  useEffect(() => {
    if (!isAuthenticated || !pendingAttachment || sharePickerVisible) {
      if (!pendingAttachment) {
        openedQueuedShareRef.current = false;
      }
      return;
    }
    if (openedQueuedShareRef.current) {
      return;
    }
    openedQueuedShareRef.current = true;
    openSharePicker(pendingAttachment);
  }, [isAuthenticated, pendingAttachment, sharePickerVisible, openSharePicker]);

  return null;
}
