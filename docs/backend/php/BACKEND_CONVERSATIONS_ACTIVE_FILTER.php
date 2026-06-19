<?php
// Fix for Conversations - Filter Active Users Only

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Conversation extends Model
{
    // Update getConversationsForSidebar2 to filter active users
    public static function getConversationsForSidebar2(User $user)
    {
        $userId = $user->id;
        
        // ✅ INDIVIDUAL CONVERSATIONS ONLY - No groups
        // ✅ Filter only active users
        $users = User::where('id', '!=', $userId)
            ->where('active_status', 1) // ✅ Only active users
            ->get();
        
        // ✅ FILTER: Only include users where current user has sent at least one message
        $usersWithOurMessages = $users->filter(function (User $otherUser) use ($userId) {
            return Mezzage::where('sender_id', $userId)
                ->where('receiver_id', $otherUser->id)
                ->exists();
        });
        
        // ✅ ONLY RETURN INDIVIDUAL CONVERSATIONS (No groups)
        $userConversations = $usersWithOurMessages->map(function (User $otherUser) use ($userId) {
            $conversation = $otherUser->toConversationArray();
            
            // ✅ CALCULATE UNREAD COUNT:
            // Count messages sent TO current user that haven't been read (read_at IS NULL)
            // Only count messages where sender_id != current_user_id (messages sent to us)
            $unreadCount = Mezzage::where(function ($query) use ($userId, $otherUser) {
                // Messages between current user and this user
                $query->where(function ($q) use ($userId, $otherUser) {
                    $q->where('sender_id', $otherUser->id)
                    ->where('receiver_id', $userId);
                })->orWhere(function ($q) use ($userId, $otherUser) {
                    $q->where('sender_id', $userId)
                    ->where('receiver_id', $otherUser->id);
                });
            })
            ->whereNull('read_at')              // Only unread messages (read_at IS NULL)
            ->where('sender_id', '!=', $userId)  // Only messages sent TO us (not by us)
            ->whereNull('group_id')              // Individual conversations only
            ->count();
            
            $conversation['unread_count'] = $unreadCount;
            
            // ✅ ADD READ RECEIPT FIELDS:
            $lastMessage = Mezzage::where(function ($query) use ($userId, $otherUser) {
                $query->where('sender_id', $userId)
                    ->where('receiver_id', $otherUser->id);
            })->orWhere(function ($query) use ($userId, $otherUser) {
                $query->where('sender_id', $otherUser->id)
                    ->where('receiver_id', $userId);
            })
            ->latest()
            ->first();
            
            if ($lastMessage) {
                $conversation['last_message_sender_id'] = $lastMessage->sender_id;
                
                if ($lastMessage->sender_id == $userId) {
                    $conversation['last_message_read_at'] = $lastMessage->read_at;
                } else {
                    $conversation['last_message_read_at'] = null;
                }
            } else {
                $conversation['last_message_sender_id'] = null;
                $conversation['last_message_read_at'] = null;
            }
            
            $conversation['is_user'] = true;
            $conversation['is_group'] = false;
            
            return $conversation;
        });
        
        return $userConversations;
    }
}

