<?php
// Fix for User Model's toConversationArray() method
// Replace the avatar_url lines to compute from profile_image

public function toConversationArray(?User $currentUser = null)
{
    // Helper function to safely format date
    $formatDate = function($date) {
        if (!$date) return null;
        if ($date instanceof \Carbon\Carbon) {
            return $date->toISOString();
        }
        // If already a string, return as-is (assuming it's already formatted)
        return is_string($date) ? $date : (string)$date;
    };
    
    // ✅ Compute avatar_url from profile_image (like UserResource does)
    $avatarUrl = $this->profile_image 
        ? asset('storage/profile_images/' . $this->profile_image) 
        : null;
    
    return [
        'id' => $this->id,
        'name' => $this->name,
        'email' => $this->email,
        'avatar_url' => $avatarUrl, // ✅ Fixed: computed from profile_image
        'is_user' => true,
        'is_group' => false,
        'user_id' => $this->id,
        'user' => [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'avatar_url' => $avatarUrl, // ✅ Fixed: computed from profile_image
            'last_seen_at' => $formatDate($this->last_seen_at),
            'created_at' => $formatDate($this->created_at),
            'updated_at' => $formatDate($this->updated_at),
        ],
        'last_seen_at' => $formatDate($this->last_seen_at),
        'created_at' => $formatDate($this->created_at),
        'updated_at' => $formatDate($this->updated_at),
        'last_message' => $this->last_message,
        'last_message_date' => $this->last_message_date,
    ];
}

