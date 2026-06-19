<?php

/**
 * Drop-in replacement for App\Events\SocketMessage
 * Aligns with TechChat app realtimeService.ts:
 *   - Channels: private-conversation.{individual|group}.{id}
 *   - Event:    MessageSent
 *   - Payload:  flat MessageResource fields (not nested under "message")
 */

namespace App\Events;

use App\Http\Resources\MessageResource;
use App\Models\Mezzage;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class SocketMessage implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public Mezzage $message)
    {
        $this->message->loadMissing([
            'sender',
            'attachments',
            'replyTo.sender',
            'replyTo.attachments',
        ]);
    }

    /**
     * Flat payload — app calls apiMessageToChatMessage(data) on the root object.
     */
    public function broadcastWith(): array
    {
        return (new MessageResource($this->message))->resolve();
    }

    public function broadcastAs(): string
    {
        return 'MessageSent';
    }

    public function broadcastOn(): array
    {
        $m = $this->message;
        $channels = [];

        if ($m->group_id) {
            $channels[] = new PrivateChannel('conversation.group.'.$m->group_id);
        } else {
            // Each user opens chat subscribed to the *other* user's id
            if ($m->receiver_id) {
                $channels[] = new PrivateChannel('conversation.individual.'.$m->receiver_id);
            }
            if ($m->sender_id) {
                $channels[] = new PrivateChannel('conversation.individual.'.$m->sender_id);
            }
        }

        return $channels;
    }
}

/*
 * routes/channels.php — add or replace old message.user / message.group auth
 *
 * use Illuminate\Support\Facades\Broadcast;
 *
 * Broadcast::channel('conversation.individual.{userId}', function ($user, $userId) {
 *     return (int) $user->id === (int) $userId;
 * });
 *
 * Broadcast::channel('conversation.group.{groupId}', function ($user, $groupId) {
 *     return \App\Models\Group::where('id', $groupId)
 *         ->whereHas('members', fn ($q) => $q->where('user_id', $user->id))
 *         ->exists();
 * });
 *
 * Remove or keep legacy channels if a web client still uses message.user.* / message.group.*
 */
