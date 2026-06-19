<?php
// Backend fix for conversations endpoint to include attachment data
// This should be added to your ConversationController or wherever conversations are fetched

public function index()
{
    $conversations = Conversation::with(['lastMessage.attachments'])
        ->where('user_id', auth()->id())
        ->orWhere('receiver_id', auth()->id())
        ->orderBy('updated_at', 'desc')
        ->get();

    $formattedConversations = $conversations->map(function ($conversation) {
        $lastMessage = $conversation->lastMessage;
        
        return [
            'id' => $conversation->id,
            'name' => $conversation->name,
            'email' => $conversation->email,
            'avatar_url' => $conversation->avatar_url,
            'is_user' => $conversation->is_user,
            'is_group' => $conversation->is_group,
            'is_admin' => $conversation->is_admin,
            'created_at' => $conversation->created_at,
            'updated_at' => $conversation->updated_at,
            'blocked_at' => $conversation->blocked_at,
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


