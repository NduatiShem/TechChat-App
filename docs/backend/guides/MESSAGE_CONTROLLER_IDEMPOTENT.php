<?php

/**
 * Backend reference — tailored to your MessageController.
 * Copy sections into your Laravel project; this file is not executed by the app.
 *
 * Full walkthrough: docs/backend/guides/MESSAGE_CONTROLLER_UPGRADE.md
 */

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreMessageRequest;
use App\Http\Resources\MessageResource;
use App\Models\Group;
use App\Models\Mezzage;
use App\Models\User;
use Illuminate\Http\Request;

class MessageControllerReference
{
    // --- Migration ---
    // Schema::table('mezzages', function (Blueprint $table) {
    //     $table->uuid('client_message_id')->nullable()->unique()->after('id');
    // });

    // --- StoreMessageRequest ---
    // 'client_message_id' => ['nullable', 'uuid'],

    // --- MessageResource::toArray() ---
    // 'client_message_id' => $this->client_message_id,

    public function store(StoreMessageRequest $request)
    {
        $data = $request->validated();
        $data['sender_id'] = auth()->id();
        $clientMessageId = $data['client_message_id'] ?? null;
        $receiverId = $data['receiver_id'] ?? null;
        $groupId = $data['group_id'] ?? null;
        $files = $data['attachments'] ?? [];

        $loadRelations = fn (Mezzage $message) => $message->load([
            'sender', 'attachments', 'replyTo.sender', 'replyTo.attachments',
        ]);

        if ($clientMessageId) {
            $existing = Mezzage::where('client_message_id', $clientMessageId)
                ->where('sender_id', auth()->id())
                ->first();

            if ($existing) {
                return new MessageResource($loadRelations($existing));
            }
        }

        try {
            $message = Mezzage::create($data);
        } catch (\Illuminate\Database\QueryException $e) {
            if ($clientMessageId && str_contains($e->getMessage(), 'client_message_id')) {
                $existing = Mezzage::where('client_message_id', $clientMessageId)
                    ->where('sender_id', auth()->id())
                    ->first();

                if ($existing) {
                    return new MessageResource($loadRelations($existing));
                }
            }
            throw $e;
        }

        // Attachment handling, Conversation::update..., Group::update..., SocketMessage::dispatch...

        return new MessageResource($loadRelations($message));
    }

    public function byUser(User $user, Request $request)
    {
        $query = Mezzage::with(['sender', 'attachments', 'replyTo.sender', 'replyTo.attachments'])
            ->where(function ($q) use ($user) {
                $q->where(function ($q2) use ($user) {
                    $q2->where('sender_id', auth()->id())
                        ->where('receiver_id', $user->id);
                })->orWhere(function ($q2) use ($user) {
                    $q2->where('sender_id', $user->id)
                        ->where('receiver_id', auth()->id());
                });
            })
            ->whereNull('group_id');

        if ($request->filled('after_id')) {
            $query->where('id', '>', (int) $request->input('after_id'));
        } elseif ($request->filled('since')) {
            $query->where('created_at', '>', $request->input('since'));
        }

        $perPage = min((int) $request->input('per_page', 10), 100);
        $messages = $query->latest()->paginate($perPage);

        $items = $messages->items();
        $newestMessageId = ! empty($items) ? $items[0]->id : null;

        return response()->json([
            'selectedConversation' => $user->toConversationArray(),
            'messages' => [
                'data' => MessageResource::collection($items),
                'current_page' => $messages->currentPage(),
                'last_page' => $messages->lastPage(),
                'per_page' => $messages->perPage(),
                'total' => $messages->total(),
                'from' => $messages->firstItem(),
                'to' => $messages->lastItem(),
                'newest_message_id' => $newestMessageId,
            ],
        ]);
    }

    public function byGroup(Group $group, Request $request)
    {
        $query = Mezzage::with(['sender', 'attachments', 'replyTo.sender', 'replyTo.attachments'])
            ->where('group_id', $group->id);

        if ($request->filled('after_id')) {
            $query->where('id', '>', (int) $request->input('after_id'));
        } elseif ($request->filled('since')) {
            $query->where('created_at', '>', $request->input('since'));
        }

        $perPage = min((int) $request->input('per_page', 10), 100);
        $messages = $query->latest()->paginate($perPage);

        $items = $messages->items();
        $newestMessageId = ! empty($items) ? $items[0]->id : null;

        return response([
            'selectedConversation' => $group->toConversationArray(),
            'messages' => [
                'data' => MessageResource::collection($items),
                'current_page' => $messages->currentPage(),
                'last_page' => $messages->lastPage(),
                'per_page' => $messages->perPage(),
                'total' => $messages->total(),
                'from' => $messages->firstItem(),
                'to' => $messages->lastItem(),
                'newest_message_id' => $newestMessageId,
            ],
        ]);
    }
}
