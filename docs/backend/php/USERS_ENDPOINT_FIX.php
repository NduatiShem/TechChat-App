<?php
// Fix for users() method - Use correct column name and path

public function users(Request $request)
{
    $user = $request->user();
    $users = User::getUserExceptUser($user);
    
    // Transform users to include avatar_url
    $usersWithAvatars = $users->map(function($user) {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            // ✅ FIX: Use profile_image (not avatar) and correct path
            'avatar_url' => $user->profile_image 
                ? asset('storage/profile_images/' . $user->profile_image) 
                : null,
            'created_at' => $user->created_at,
            'updated_at' => $user->updated_at,
        ];
    });
    
    return response()->json($usersWithAvatars);
}

