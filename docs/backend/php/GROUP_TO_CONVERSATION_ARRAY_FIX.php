<?php
// Fix for Group model's toConversationArray() method
// Add avatar_url for the group itself

public function toConversationArray()
{
    // Load users relationship if not already loaded
    if (!$this->relationLoaded('users')) {
        $this->load('users');
    }
    
    // Get last message if available
    $lastMessage = $this->lastMessage;
    
    // Format dates safely
    $formatDate = function($date) {
        if (!$date) return null;
        if ($date instanceof \Carbon\Carbon) {
            return $date->toISOString();
        }
        return is_string($date) ? $date : (string)$date;
    };
    
    return [
        'id' => $this->id,
        'name' => $this->name,
        'description' => $this->description,
        // ✅ Add avatar_url for the group itself
        'avatar_url' => $this->profile_image 
            ? asset('storage/group_images/' . $this->profile_image) 
            : null,
        'is_group' => true,
        'is_user' => false,
        'owner_id' => $this->owner_id,
        'users' => $this->users->map(function($user) {
            return [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'avatar_url' => $user->profile_image ? asset('storage/profile_images/' . $user->profile_image) : ($user->avatar_url ?? null),
            ];
        })->toArray(),
        'user_ids' => $this->users->pluck('id')->toArray(),
        'created_at' => $formatDate($this->created_at),
        'updated_at' => $formatDate($this->updated_at),
        'last_message' => $lastMessage ? $lastMessage->message : ($this->last_message ?? null),
        'last_message_date' => $lastMessage ? $formatDate($lastMessage->created_at) : ($this->last_message_date ? $formatDate($this->last_message_date) : null),
    ];
}

