# Backend Implementation Guide: Using `read_at` for Unread Counts

## Overview
The message system uses the `read_at` field on the messages table to track read/unread status:
- **New messages**: `read_at = null` (unread)
- **Read messages**: `read_at = timestamp` (when user opens the conversation)

## Backend Requirements

### 1. Message Model
The messages table should have a `read_at` field:
```php
Schema::table('messages', function (Blueprint $table) {
    $table->timestamp('read_at')->nullable()->after('created_at');
});
```

### 2. Conversations Endpoint (`GET /api/conversations`)
Calculate `unread_count` for each conversation based on messages where `read_at IS NULL` and `sender_id != auth()->id()`:

```php
// In ConversationController or UserController
public function index()
{
    $conversations = Conversation::with(['lastMessage.attachments'])
        ->where('user_id', auth()->id())
        ->orWhere('receiver_id', auth()->id())
        ->orderBy('updated_at', 'desc')
        ->get();

    $formattedConversations = $conversations->map(function ($conversation) {
        $lastMessage = $conversation->lastMessage;
        
        // Calculate unread count: messages where read_at IS NULL and sender_id != current user
        $unreadCount = Message::where(function($query) use ($conversation) {
            if ($conversation->is_user) {
                // For individual conversations
                $query->where(function($q) use ($conversation) {
                    $q->where('sender_id', $conversation->user_id ?? $conversation->receiver_id)
                      ->where('receiver_id', auth()->id());
                })->orWhere(function($q) use ($conversation) {
                    $q->where('sender_id', auth()->id())
                      ->where('receiver_id', $conversation->user_id ?? $conversation->receiver_id);
                });
            } else {
                // For group conversations
                $query->where('group_id', $conversation->id);
            }
        })
        ->whereNull('read_at')
        ->where('sender_id', '!=', auth()->id()) // Don't count messages sent by current user
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
            'unread_count' => $unreadCount, // Add this
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

    return response()->json($formattedConversations);
}
```

### 3. Mark as Read Endpoint (`PUT /api/conversations/{id}/read`)
Update `read_at` timestamp for all unread messages in the conversation:

```php
// In ConversationController or MessageController
public function markAsRead($id, Request $request)
{
    $type = $request->query('type', 'individual'); // 'individual' or 'group'
    
    $query = Message::whereNull('read_at')
        ->where('sender_id', '!=', auth()->id()); // Don't mark own messages as read
    
    if ($type === 'individual') {
        // Find the conversation to get both user IDs
        $conversation = Conversation::find($id);
        if (!$conversation) {
            // Try to find by user_id
            $conversation = User::find($id);
            if ($conversation) {
                $userId = $conversation->id;
                $query->where(function($q) use ($userId) {
                    $q->where('sender_id', $userId)
                      ->where('receiver_id', auth()->id())
                      ->orWhere(function($q2) use ($userId) {
                          $q2->where('sender_id', auth()->id())
                             ->where('receiver_id', $userId);
                      });
                });
            }
        } else {
            $userId = $conversation->user_id ?? $conversation->receiver_id;
            $query->where(function($q) use ($userId) {
                $q->where('sender_id', $userId)
                  ->where('receiver_id', auth()->id())
                  ->orWhere(function($q2) use ($userId) {
                      $q2->where('sender_id', auth()->id())
                         ->where('receiver_id', $userId);
                  });
            });
        }
    } else {
        // Group conversation
        $query->where('group_id', $id);
    }
    
    // Update read_at for all unread messages
    $updated = $query->update([
        'read_at' => now()
    ]);
    
    return response()->json([
        'message' => 'Messages marked as read',
        'updated_count' => $updated
    ]);
}
```

### 4. Unread Count Endpoint (`GET /api/messages/unread-count`)
Return total unread count and optionally per-conversation counts:

```php
public function getUnreadCount()
{
    // Get total unread count (all messages where read_at IS NULL)
    $totalUnread = Message::whereNull('read_at')
        ->where('sender_id', '!=', auth()->id())
        ->where(function($query) {
            // Individual conversations
            $query->where(function($q) {
                $q->where('receiver_id', auth()->id())
                  ->whereNull('group_id');
            })
            // Group conversations
            ->orWhereHas('group', function($q) {
                $q->whereHas('members', function($memberQuery) {
                    $memberQuery->where('user_id', auth()->id());
                });
            });
        })
        ->count();
    
    // Get unread counts per conversation
    $conversationCounts = [];
    
    // Individual conversations
    $individualUnreads = Message::whereNull('read_at')
        ->where('sender_id', '!=', auth()->id())
        ->where('receiver_id', auth()->id())
        ->whereNull('group_id')
        ->selectRaw('sender_id as conversation_id, COUNT(*) as count')
        ->groupBy('sender_id')
        ->get();
    
    foreach ($individualUnreads as $unread) {
        $conversationCounts[$unread->conversation_id] = $unread->count;
    }
    
    // Group conversations
    $groupUnreads = Message::whereNull('read_at')
        ->where('sender_id', '!=', auth()->id())
        ->whereNotNull('group_id')
        ->whereHas('group', function($q) {
            $q->whereHas('members', function($memberQuery) {
                $memberQuery->where('user_id', auth()->id());
            });
        })
        ->selectRaw('group_id as conversation_id, COUNT(*) as count')
        ->groupBy('group_id')
        ->get();
    
    foreach ($groupUnreads as $unread) {
        $conversationCounts[$unread->conversation_id] = $unread->count;
    }
    
    return response()->json([
        'total_unread' => $totalUnread,
        'unread_count' => $totalUnread, // Alias for compatibility
        'conversations' => $conversationCounts // Optional: per-conversation counts
    ]);
}
```

## Summary

1. ✅ **New messages**: Created with `read_at = null`
2. ✅ **Conversations endpoint**: Returns `unread_count` based on messages where `read_at IS NULL` and `sender_id != auth()->id()`
3. ✅ **Mark as read endpoint**: Updates `read_at = now()` for all unread messages in the conversation
4. ✅ **Unread count endpoint**: Returns total unread count based on `read_at IS NULL`

The frontend already:
- Calls `markAsRead()` when user opens a conversation
- Syncs unread counts from the backend
- Updates badges based on unread counts
- Shows counters on tab and individual conversation items

