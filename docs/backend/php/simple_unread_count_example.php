<?php
// SIMPLE EXAMPLE: How to add unread_count to your conversations controller

// In your ConversationController's index() method, add this inside the map() function:

$formattedConversations = $conversations->map(function ($conversation) use ($userId) {
    $lastMessage = $conversation->lastMessage;
    
    // ✅ ADD THIS: Calculate unread count
    // Count messages where read_at IS NULL and sender_id != current user
    $unreadCount = Mezzage::where(function($query) use ($conversation, $userId) {
        // For individual conversations (between two users)
        if ($conversation->is_user || !$conversation->is_group) {
            // Get the other user's ID
            $otherUserId = ($conversation->user_id == $userId) 
                ? $conversation->receiver_id 
                : $conversation->user_id;
            
            // Messages between current user and other user
            $query->where(function($q) use ($userId, $otherUserId) {
                $q->where('sender_id', $otherUserId)
                  ->where('receiver_id', $userId);
            })->orWhere(function($q) use ($userId, $otherUserId) {
                $q->where('sender_id', $userId)
                  ->where('receiver_id', $otherUserId);
            })->whereNull('group_id'); // Individual conversations have no group_id
        } else {
            // For group conversations
            $query->where('group_id', $conversation->group_id ?? $conversation->id);
        }
    })
    ->whereNull('read_at')        // Only unread messages (read_at IS NULL)
    ->where('sender_id', '!=', $userId)  // Don't count own messages
    ->count();
    
    return [
        'id' => $conversation->id,
        'name' => $conversation->name,
        'email' => $conversation->email,
        'avatar_url' => $conversation->avatar_url,
        'is_user' => $conversation->is_user,
        'is_group' => $conversation->is_group,
        'user_id' => $conversation->user_id,
        'conversation_id' => $conversation->id,
        'unread_count' => $unreadCount,  // ✅ ADD THIS LINE
        'created_at' => $conversation->created_at,
        'updated_at' => $conversation->updated_at,
        'last_message' => $lastMessage ? $lastMessage->message : null,
        'last_message_date' => $lastMessage ? $lastMessage->created_at : null,
        'last_message_attachments' => $lastMessage && $lastMessage->attachments ? 
            $lastMessage->attachments->map(function ($attachment) {
                return [
                    'id' => $attachment->id,
                    'name' => $attachment->name,
                    'mime' => $attachment->mime,
                    'url' => $attachment->url,
                ];
            })->toArray() : []
    ];
});

