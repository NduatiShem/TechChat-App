<?php

namespace App\Http\Controllers\Api;

use App\Models\Conversation;
use App\Models\Mezzage;
use App\Models\User;
use App\Models\Group;
use Illuminate\Http\Request;

class ConversationController extends \App\Http\Controllers\Controller
{
    /**
     * Get all conversations for the authenticated user
     * GET /api/conversations
     */
    public function index()
    {
        $userId = auth()->id();

        // Get all conversations for the user
        $conversations = Conversation::with(['lastMessage.attachments'])
            ->where('user_id', $userId)
            ->orWhere('receiver_id', $userId)
            ->orderBy('updated_at', 'desc')
            ->get();

        $formattedConversations = $conversations->map(function ($conversation) use ($userId) {
            $lastMessage = $conversation->lastMessage;
            
            // Calculate unread count: messages where read_at IS NULL and sender_id != current user
            $unreadCount = Mezzage::where(function($query) use ($conversation, $userId) {
                // For individual conversations
                if ($conversation->is_user) {
                    // Get the other user's ID
                    $otherUserId = ($conversation->user_id == $userId) 
                        ? $conversation->receiver_id 
                        : $conversation->user_id;
                    
                    // Count messages between current user and other user
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
            ->whereNull('read_at') // Only unread messages
            ->where('sender_id', '!=', $userId) // Don't count own messages
            ->count();
            
            return [
                'id' => $conversation->id,
                'name' => $conversation->name ?? $conversation->user->name ?? 'Unknown',
                'email' => $conversation->email ?? $conversation->user->email ?? null,
                'avatar_url' => $conversation->avatar_url ?? $conversation->user->avatar_url ?? null,
                'is_user' => $conversation->is_user ?? false,
                'is_group' => $conversation->is_group ?? false,
                'user_id' => $conversation->user_id ?? $conversation->id,
                'conversation_id' => $conversation->id,
                'unread_count' => $unreadCount, // ✅ Add this
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
}

