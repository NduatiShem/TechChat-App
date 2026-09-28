import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type PendingShareAttachment = {
  uri: string;
  name: string;
  type: string;
  isImage?: boolean;
};

type PendingShareContextValue = {
  pendingAttachment: PendingShareAttachment | null;
  setPendingAttachment: (attachment: PendingShareAttachment | null) => void;
  clearPendingAttachment: () => void;
  sharePickerVisible: boolean;
  openSharePicker: (attachment: PendingShareAttachment) => void;
  closeSharePicker: () => void;
};

const PendingShareContext = createContext<PendingShareContextValue | undefined>(undefined);

export function PendingShareProvider({ children }: { children: React.ReactNode }) {
  const [pendingAttachment, setPendingAttachmentState] = useState<PendingShareAttachment | null>(
    null
  );
  const [sharePickerVisible, setSharePickerVisible] = useState(false);

  const setPendingAttachment = useCallback((attachment: PendingShareAttachment | null) => {
    setPendingAttachmentState(attachment);
  }, []);

  const clearPendingAttachment = useCallback(() => {
    setPendingAttachmentState(null);
  }, []);

  const openSharePicker = useCallback((attachment: PendingShareAttachment) => {
    setPendingAttachmentState(attachment);
    setSharePickerVisible(true);
  }, []);

  const closeSharePicker = useCallback(() => {
    setSharePickerVisible(false);
    setPendingAttachmentState(null);
  }, []);

  const value = useMemo(
    () => ({
      pendingAttachment,
      setPendingAttachment,
      clearPendingAttachment,
      sharePickerVisible,
      openSharePicker,
      closeSharePicker,
    }),
    [
      pendingAttachment,
      setPendingAttachment,
      clearPendingAttachment,
      sharePickerVisible,
      openSharePicker,
      closeSharePicker,
    ]
  );

  return (
    <PendingShareContext.Provider value={value}>{children}</PendingShareContext.Provider>
  );
}

export function usePendingShare() {
  const ctx = useContext(PendingShareContext);
  if (!ctx) {
    throw new Error('usePendingShare must be used within PendingShareProvider');
  }
  return ctx;
}
