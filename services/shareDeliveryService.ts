import type { PendingShareAttachment } from '@/context/PendingShareContext';
import { buildOutboxPayload, persistOutgoingMessage } from '@/services/chatMessageService';
import { enqueueOutgoingMessage } from '@/services/outboxService';
import type { ShareRecipient } from '@/types/shareRecipient';
import { generateClientMessageId } from '@/utils/clientMessageId';

function messageTextForAttachment(attachment: PendingShareAttachment): string {
  if (attachment.isImage || attachment.type.startsWith('image/')) {
    return '[IMAGE]';
  }
  return '[FILE]';
}

export async function deliverSharedAttachment(
  attachment: PendingShareAttachment,
  recipients: ShareRecipient[],
  senderId: number
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const messageText = messageTextForAttachment(attachment);
  const now = new Date().toISOString();

  const localAttachments = [
    {
      name: attachment.name || 'attachment',
      mime: attachment.type || 'application/octet-stream',
      url: attachment.uri,
      local_path: attachment.uri,
    },
  ];

  for (const recipient of recipients) {
    const clientMessageId = generateClientMessageId();
    try {
      const outboxPayload = buildOutboxPayload({
        messageText,
        receiverId: recipient.type === 'individual' ? recipient.conversationId : undefined,
        groupId: recipient.type === 'group' ? recipient.conversationId : undefined,
        replyToId: null,
        attachment: {
          uri: attachment.uri,
          name: attachment.name,
          type: attachment.type,
        },
      });

      let localMessageId: number | null = null;
      try {
        const saved = await persistOutgoingMessage(recipient.conversationId, recipient.type, {
          client_message_id: clientMessageId,
          sender_id: senderId,
          receiver_id: recipient.type === 'individual' ? recipient.conversationId : undefined,
          group_id: recipient.type === 'group' ? recipient.conversationId : undefined,
          message: messageText,
          created_at: now,
          reply_to_id: null,
          attachments: localAttachments as never,
        });
        localMessageId = saved[0]?.localMessageId ?? null;
      } catch (dbError) {
        console.warn('[ShareDelivery] SQLite save failed, still enqueueing', dbError);
      }

      await enqueueOutgoingMessage({
        clientMessageId,
        localMessageId,
        conversationId: recipient.conversationId,
        conversationType: recipient.type,
        payload: outboxPayload,
      });
      sent += 1;
    } catch (error) {
      console.warn('[ShareDelivery] failed for', recipient.key, error);
      failed += 1;
    }
  }

  return { sent, failed };
}
