<?php
// Update your Group model's toConversationArray() method or GroupResource
// to include avatar_url computed from profile_image

// Option 1: In Group Model's toConversationArray() method
public function toConversationArray()
{
    return [
        'id' => $this->id,
        'name' => $this->name,
        'description' => $this->description,
        // ✅ Compute avatar_url from profile_image
        'avatar_url' => $this->profile_image 
            ? asset('storage/group_images/' . $this->profile_image) 
            : null,
        'owner_id' => $this->owner_id,
        'is_user' => false,
        'is_group' => true,
        'created_at' => $this->created_at,
        'updated_at' => $this->updated_at,
        // ... other fields
    ];
}

// Option 2: In GroupResource (if you're using API Resources)
namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class GroupResource extends JsonResource
{
    public function toArray($request)
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            // ✅ Compute avatar_url from profile_image
            'avatar_url' => $this->profile_image 
                ? asset('storage/group_images/' . $this->profile_image) 
                : null,
            'owner_id' => $this->owner_id,
            'is_user' => false,
            'is_group' => true,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            // ... other fields
        ];
    }
}

