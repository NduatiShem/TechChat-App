<?php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class MessageResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return array
     */
    public function toArray($request)
    {
        return [
            'id' => $this->id,
            'message' => $this->message,
            'sender_id' => $this->sender_id,
            'receiver_id' => $this->receiver_id,
            'sender' => new UserResource($this->sender),
            'group_id' => $this->group_id,
            'reply_to_id' => $this->reply_to_id, // Add this field
            'attachments' => MessageAttachmentResource::collection($this->attachments),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            'read_at' => $this->read_at,
            
            // Add reply_to data if it exists (using a simplified structure to avoid recursion)
            'reply_to' => $this->when($this->relationLoaded('replyTo') && $this->replyTo, function () {
                return [
                    'id' => $this->replyTo->id,
                    'message' => $this->replyTo->message,
                    'sender' => new UserResource($this->replyTo->sender),
                    'attachments' => MessageAttachmentResource::collection($this->replyTo->attachments),
                    'created_at' => $this->replyTo->created_at,
                ];
            }),
        ];
    }
}

