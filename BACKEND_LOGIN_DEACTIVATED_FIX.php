<?php
// Fix for Login Controller - Prevent deactivated users from logging in

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        $credentials = $request->validate([
            'email' => 'required|email',
            'password' => 'required',
        ]);
        
        // ✅ Check if user exists
        $user = User::where('email', $credentials['email'])->first();
        
        if (!$user) {
            return response()->json([
                'message' => 'Invalid credentials'
            ], 401);
        }
        
        // ✅ Check if account is deactivated
        if ($user->active_status == 0 || $user->active_status === false) {
            return response()->json([
                'message' => 'Your account has been deactivated. Please contact an administrator.',
                'account_deactivated' => true
            ], 403); // 403 Forbidden
        }
        
        // ✅ Verify password
        if (!Hash::check($credentials['password'], $user->password)) {
            return response()->json([
                'message' => 'Invalid credentials'
            ], 401);
        }
        
        // ✅ Generate token
        $token = $user->createToken('auth_token')->plainTextToken;
        
        return response()->json([
            'user' => new UserResource($user),
            'token' => $token,
        ]);
    }
}

