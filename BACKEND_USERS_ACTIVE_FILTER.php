<?php
// Fix for Users Endpoint - Filter Active Users Only

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;

class UserController extends Controller
{
    public function users(Request $request)
    {
        $user = $request->user();
        
        // ✅ Get only active users (active_status = 1)
        $users = User::where('id', '!=', $user->id)
            ->where('active_status', 1) // ✅ Only active users
            ->orderBy('name')
            ->get();
        
        // Transform users to include avatar_url
        $usersWithAvatars = $users->map(function($user) {
            return [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'avatar_url' => $user->profile_image 
                    ? asset('storage/profile_images/' . $user->profile_image) 
                    : null,
                'created_at' => $user->created_at,
                'updated_at' => $user->updated_at,
            ];
        });
        
        return response()->json($usersWithAvatars);
    }
}

