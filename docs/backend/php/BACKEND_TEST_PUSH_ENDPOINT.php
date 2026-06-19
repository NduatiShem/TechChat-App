<?php

/**
 * Add this route to your Laravel routes/api.php
 * 
 * This endpoint allows you to test push notifications locally
 * without authentication (for testing purposes only)
 */

// For testing - remove auth middleware temporarily
Route::post('/test-push', function (Request $request) {
    $validated = $request->validate([
        'fcm_token' => 'required|string',
        'title' => 'required|string|max:255',
        'body' => 'required|string|max:500',
        'data' => 'nullable|array',
    ]);
    
    try {
        $pushService = new \App\Services\PushNotificationService();
        
        $token = $validated['fcm_token'];
        $title = $validated['title'];
        $body = $validated['body'];
        $data = $validated['data'] ?? [];
        
        // Add test metadata
        $data['test'] = true;
        $data['timestamp'] = now()->toISOString();
        $data['source'] = 'test-endpoint';
        
        // Determine token type and send accordingly
        if (strpos($token, 'ExponentPushToken') === 0 || strpos($token, 'ExpoPushToken') === 0) {
            // Expo push token - use Expo API
            \Log::info('Testing Expo push notification', [
                'token_preview' => substr($token, 0, 30) . '...',
                'title' => $title
            ]);
            
            $result = $pushService->sendExpoNotification($token, $title, $body, $data);
        } else {
            // Native FCM token - use FCM v1
            \Log::info('Testing FCM v1 notification', [
                'token_preview' => substr($token, 0, 30) . '...',
                'title' => $title
            ]);
            
            $result = $pushService->sendNotification($token, $title, $body, $data);
        }
        
        return response()->json([
            'success' => $result['success'] ?? false,
            'message' => $result['success'] 
                ? 'Notification sent successfully!' 
                : 'Failed to send notification',
            'method' => $result['method'] ?? 'unknown',
            'error' => $result['error'] ?? null,
            'details' => $result,
        ]);
        
    } catch (\Exception $e) {
        \Log::error('Test push notification failed', [
            'error' => $e->getMessage(),
            'trace' => $e->getTraceAsString()
        ]);
        
        return response()->json([
            'success' => false,
            'message' => 'Error sending notification',
            'error' => $e->getMessage(),
        ], 500);
    }
}); // Remove ->middleware('auth:sanctum') for testing

/**
 * Alternative: Test endpoint with authentication
 * Use this if you want to test with a logged-in user
 */
Route::post('/test-push-authenticated', function (Request $request) {
    $validated = $request->validate([
        'title' => 'required|string|max:255',
        'body' => 'required|string|max:500',
        'data' => 'nullable|array',
    ]);
    
    $user = auth()->user();
    
    if (!$user || !$user->fcm_token) {
        return response()->json([
            'success' => false,
            'message' => 'User not authenticated or no FCM token found',
        ], 400);
    }
    
    try {
        $pushService = new \App\Services\PushNotificationService();
        
        $title = $validated['title'];
        $body = $validated['body'];
        $data = $validated['data'] ?? ['test' => true];
        
        // Determine token type
        $token = $user->fcm_token;
        if (strpos($token, 'ExponentPushToken') === 0 || strpos($token, 'ExpoPushToken') === 0) {
            $result = $pushService->sendExpoNotification($token, $title, $body, $data);
        } else {
            $result = $pushService->sendNotification($token, $title, $body, $data);
        }
        
        return response()->json([
            'success' => $result['success'] ?? false,
            'message' => $result['success'] 
                ? 'Notification sent to your device!' 
                : 'Failed to send notification',
            'method' => $result['method'] ?? 'unknown',
            'details' => $result,
        ]);
        
    } catch (\Exception $e) {
        return response()->json([
            'success' => false,
            'message' => 'Error sending notification',
            'error' => $e->getMessage(),
        ], 500);
    }
})->middleware('auth:sanctum');

