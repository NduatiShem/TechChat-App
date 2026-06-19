<?php

namespace App\Http\Controllers\Api;

use App\Events\SocketMessage;
use App\Http\Requests\StoreMessageRequest;
use App\Http\Resources\MessageResource;
use App\Models\Conversation;
use App\Models\Group;
use App\Models\Mezzage;
use App\Models\MessageAttachment;
use App\Models\User;
use App\Services\PushNotificationService;
use Illuminate\Http\Request;
use App\Events\MessageRead;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Log;

class MessageController extends \App\Http\Controllers\Controller
{
    public function byUser(User $user)
    {
        $messages = Mezzage::where(function ($query) use ($user) {
            $query->where('sender_id', auth()->id())
                  ->where('receiver_id', $user->id);
        })->orWhere(function ($query) use ($user) {
            $query->where('sender_id', $user->id)
                  ->where('receiver_id', auth()->id());
        })
        ->latest()
        ->paginate(10);

        // Refresh user to get latest last_seen_at
        $user->refresh();

        return response()->json([
            'selectedConversation' => $user->toConversationArray(), 
            'messages' => MessageResource::collection($messages)
        ]);
    }

    public function byGroup(Group $group)
    {
        $messages = Mezzage::where('group_id', $group->id)
            ->latest()
            ->paginate(10);

        return response([
            'selectedConversation' => $group->toConversationArray(), 
            'messages' => MessageResource::collection($messages),
        ]);
    }

    public function loadOlder(Mezzage $message)
    {
        if($message->group_id){
            $messages = Mezzage::where('created_at', '<', $message->created_at)
                ->where('group_id', $message->group_id)
                ->latest()
                ->paginate(10);
        }else{
            $messages = Mezzage::where('created_at', '<', $message->created_at)
                ->where(function ($query) use ($message) {
                    $query->where('sender_id', $message->sender_id)
                        ->where('receiver_id', $message->receiver_id)
                        ->orWhere('sender_id', $message->receiver_id)
                        ->where('receiver_id', $message->sender_id);
                })
                ->latest()
                ->paginate(10);
        }

        return MessageResource::collection($messages);
    }

    public function store(StoreMessageRequest $request)
    {
        // Log the raw request data for debugging
        Log::info('Raw request data:', [
            'all' => $request->all(),
            'files' => $request->allFiles(),
            'has_attachments' => $request->hasFile('attachments'),
            'message' => $request->input('message'),
            'receiver_id' => $request->input('receiver_id'),
            'group_id' => $request->input('group_id'),
            'reply_to_id' => $request->input('reply_to_id'),
        ]);

        $data = $request->validated();
        $data['sender_id'] = auth()->id();
        $receiverId = $data['receiver_id'] ?? null;
        $groupId = $data['group_id'] ?? null;
        $replyToId = $data['reply_to_id'] ?? null;
        $files = $data['attachments'] ?? [];

        // Log the incoming data for debugging
        Log::info('Message store request data:', [
            'data' => $data,
            'files_count' => count($files),
            'has_message' => isset($data['message']),
            'message_length' => isset($data['message']) ? strlen($data['message']) : 0,
            'reply_to_id' => $replyToId
        ]);

        try {
            // New messages should have read_at = null (unread)
            // This happens automatically if read_at defaults to null in the database
            $message = Mezzage::create($data);
        } catch (\Exception $e) {
            Log::error('Failed to create message:', [
                'error' => $e->getMessage(),
                'data' => $data
            ]);
            throw $e;
        }

        $attachments = [];
        if($files){
            foreach ($files as $file) {
                $directory = 'attachments/' . Str::random(32);
                Storage::makeDirectory($directory);

                // Log file details for debugging
                Log::info('Processing file:', [
                    'original_name' => $file->getClientOriginalName(),
                    'mime_type' => $file->getClientMimeType(),
                    'size' => $file->getSize(),
                    'extension' => $file->getClientOriginalExtension(),
                ]);

                // Ensure voice files have correct extension
                $fileName = $file->getClientOriginalName();
                if ($file->getClientMimeType() === 'audio/m4a' && !str_ends_with($fileName, '.m4a')) {
                    $fileName = pathinfo($fileName, PATHINFO_FILENAME) . '.m4a';
                }

                $model = [
                    'mezzage_id' => $message->id,
                    'name' => $fileName,
                    'mime' => $file->getClientMimeType(),
                    'size' => $file->getSize(),
                    'path' => $file->storeAs($directory, $fileName, 'public'),
                ];

                Log::info('Created attachment:', $model);

                $attachment = MessageAttachment::create($model);
                $attachments[] = $attachment;
            }
            $message->attachments = $attachments;
        }

        if($receiverId){
            Conversation::updateConversationWithMessage($receiverId, auth()->id(), $message);
        }

        if($groupId){
            Group::updateGroupWithMessage($groupId, $message);
        }

        SocketMessage::dispatch($message);

        // Send push notification
        try {
            $pushService = new PushNotificationService();

            if ($receiverId) {
                $conversation = User::find($receiverId)->toConversationArray(auth()->user());
                $pushService->sendNewMessageNotification($message, $conversation);
            } elseif ($groupId) {
                $conversation = Group::find($groupId)->toConversationArray();
                $pushService->sendNewMessageNotification($message, $conversation);
            }
        } catch (\Exception $e) {
            \Log::error('Failed to send push notification: ' . $e->getMessage());
        }

        return new MessageResource($message);
    }

    public function destroy(Mezzage $message)
    {
        if ($message->sender_id != auth()->id()){
            return response()->json(['message' => 'Forbidden'],403);
        }

        $lastMessage = null;

        // Handle foreign key constraints by updating references before deletion
        if ($message->group_id){
            // Check if this message is the last message in the group
            $group = Group::where('last_message_id', $message->id)->first();

            if ($group) {
                // Find the previous message in the group
                $previousMessage = Mezzage::where('group_id', $message->group_id)
                    ->where('id', '!=', $message->id)
                    ->latest()
                    ->first();

                // Update the group's last_message_id
                $group->update(['last_message_id' => $previousMessage ? $previousMessage->id : null]);
                $lastMessage = $previousMessage;
            }
        } else {
            // Check if this message is the last message in the conversation
            $conversation = Conversation::where('last_message_id', $message->id)->first();

            if ($conversation) {
                // Find the previous message in the conversation
                $previousMessage = Mezzage::where(function ($query) use ($message) {
                    $query->where('sender_id', $message->sender_id)
                        ->where('receiver_id', $message->receiver_id)
                        ->orWhere('sender_id', $message->receiver_id)
                        ->where('receiver_id', $message->sender_id);
                })
                ->where('id', '!=', $message->id)
                ->latest()
                ->first();

                // Update the conversation's last_message_id
                $conversation->update(['last_message_id' => $previousMessage ? $previousMessage->id : null]);
                $lastMessage = $previousMessage;
            }
        }

        // Now delete the message (this will cascade delete replies due to foreign key constraint)
        $message->delete();

        return response()->json(['message' => $lastMessage ? new MessageResource($lastMessage) : null]);
    }

    /**
     * Mark all unread messages in a conversation as read
     * Called when user opens a conversation
     * Route: PUT /api/conversations/{id}/read?type={type}
     */
    public function markConversationAsRead($id, Request $request)
    {
        $type = $request->query('type', 'individual'); // 'individual' or 'group'
        $userId = auth()->id();

        // Build query for unread messages where sender_id != current user
        $query = Mezzage::whereNull('read_at')
            ->where('sender_id', '!=', $userId); // Don't mark own messages as read

        if ($type === 'individual') {
            // For individual conversations, find all messages between current user and the other user
            // The $id could be a user ID or conversation ID
            $user = User::find($id);
            
            if (!$user) {
                // Try to find conversation
                $conversation = Conversation::find($id);
                if ($conversation) {
                    $otherUserId = $conversation->user_id == $userId 
                        ? $conversation->receiver_id 
                        : $conversation->user_id;
                } else {
                    return response()->json(['error' => 'Conversation not found'], 404);
                }
            } else {
                $otherUserId = $user->id;
            }

            // Get all messages between current user and other user
            $query->where(function($q) use ($userId, $otherUserId) {
                $q->where(function($q2) use ($userId, $otherUserId) {
                    $q2->where('sender_id', $otherUserId)
                       ->where('receiver_id', $userId);
                })->orWhere(function($q2) use ($userId, $otherUserId) {
                    $q2->where('sender_id', $userId)
                       ->where('receiver_id', $otherUserId);
                });
            })->whereNull('group_id'); // Individual conversations have no group_id
        } else {
            // For group conversations, $id is the group ID
            $group = Group::find($id);
            
            if (!$group) {
                return response()->json(['error' => 'Group not found'], 404);
            }

            // Check if user is a member of the group
            if (!$group->members()->where('user_id', $userId)->exists()) {
                return response()->json(['error' => 'Unauthorized'], 403);
            }

            $query->where('group_id', $id);
        }

        // Update read_at for all unread messages in the conversation
        $updated = $query->update([
            'read_at' => now()
        ]);

        Log::info('Marked messages as read', [
            'conversation_id' => $id,
            'type' => $type,
            'updated_count' => $updated,
            'user_id' => $userId
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Messages marked as read',
            'updated_count' => $updated
        ]);
    }

    /**
     * Mark a single message as read (if you want to keep this functionality)
     * This is different from markConversationAsRead - it marks just one message
     */
    public function markAsRead(Request $request)
    {
        $validated = $request->validate([
            'messageId' => 'required|integer',
            'groupId' => 'nullable|integer',
            'userId' => 'nullable|integer'
        ]);

        $message = Mezzage::findOrFail($validated['messageId']);
        $user = auth()->user();

        // Check if the user is authorized to mark the message as read
        if ($message->group_id) {
            // For group messages: Check if user is a member of the group
            $group = Group::findOrFail($message->group_id);
            if ($group->members()->where('user_id', $user->id)->exists()) {
                // Only mark as read if it's not the user's own message
                if ($message->sender_id != $user->id && is_null($message->read_at)) {
                    $message->update(['read_at' => now()]);
                    
                    // Dispatch the read event with the user who marked it as read
                    event(new MessageRead($message, $user));
                }
            }
        } else {
            // For user messages: Only the recipient can mark as read
            // And only if it's not their own message
            if ($message->receiver_id === $user->id && $message->sender_id != $user->id && is_null($message->read_at)) {
                $message->update(['read_at' => now()]);
                
                // Dispatch the read event
                event(new MessageRead($message, $user));
            }
        }

        return response()->json(['success' => true]);
    }
}

