# 🔄 FCM v1 Migration Guide for Laravel Backend

## 📋 Overview

This guide helps you migrate from FCM Legacy API to FCM v1 (HTTP v1 API) in your Laravel backend.

**Why Migrate?**
- FCM Legacy API was deprecated (June 2023) and shut down (July 2024)
- FCM v1 is the current standard with better security and features
- Uses OAuth2 tokens instead of server keys

---

## ✅ Prerequisites

1. **Service Account JSON File** (You already have this!)
   - File: `chat-32491-firebase-adminsdk-fbsvc-ba1cc2d1c6.json`
   - Contains credentials for FCM v1

2. **Laravel Package**
   - Install Firebase Admin SDK for PHP

---

## 📦 Step 1: Install Firebase Admin SDK

```bash
cd /path/to/your/laravel/backend
composer require kreait/firebase-php
```

This package provides FCM v1 support.

---

## 📁 Step 2: Store Service Account JSON

### Option A: Store in Laravel (Recommended for Development)

1. Copy your service account JSON to Laravel's storage:
   ```bash
   cp chat-32491-firebase-adminsdk-fbsvc-ba1cc2d1c6.json storage/app/firebase-service-account.json
   ```

2. Add to `.env`:
   ```env
   FIREBASE_CREDENTIALS_PATH=storage/app/firebase-service-account.json
   FIREBASE_PROJECT_ID=chat-32491
   ```

### Option B: Store as Environment Variable (Recommended for Production)

1. Base64 encode the JSON file:
   ```bash
   base64 -i chat-32491-firebase-adminsdk-fbsvc-ba1cc2d1c6.json
   ```

2. Add to `.env`:
   ```env
   FIREBASE_CREDENTIALS_BASE64=<paste_base64_encoded_content>
   FIREBASE_PROJECT_ID=chat-32491
   ```

---

## 🔧 Step 3: Update PushNotificationService

Create or update `app/Services/PushNotificationService.php`:

```php
<?php

namespace App\Services;

use Kreait\Firebase\Factory;
use Kreait\Firebase\Messaging\CloudMessage;
use Kreait\Firebase\Messaging\Notification;
use Kreait\Firebase\Messaging\AndroidConfig;
use Kreait\Firebase\Messaging\ApnsConfig;
use Illuminate\Support\Facades\Log;
use App\Models\User;

class PushNotificationService
{
    private $messaging;
    private $projectId;

    public function __construct()
    {
        $this->projectId = config('firebase.project_id', env('FIREBASE_PROJECT_ID', 'chat-32491'));
        
        try {
            $factory = new Factory();
            
            // Option A: Use file path
            if (config('firebase.credentials_path')) {
                $credentialsPath = base_path(config('firebase.credentials_path'));
                $factory = $factory->withServiceAccount($credentialsPath);
            }
            // Option B: Use base64 encoded credentials
            elseif (config('firebase.credentials_base64')) {
                $credentialsJson = base64_decode(config('firebase.credentials_base64'));
                $factory = $factory->withServiceAccount($credentialsJson);
            }
            // Option C: Use JSON string directly
            else {
                $credentialsPath = storage_path('app/firebase-service-account.json');
                if (file_exists($credentialsPath)) {
                    $factory = $factory->withServiceAccount($credentialsPath);
                } else {
                    throw new \Exception('Firebase credentials not found');
                }
            }
            
            $this->messaging = $factory->createMessaging();
        } catch (\Exception $e) {
            Log::error('Failed to initialize Firebase: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * Send push notification to a user's Expo push token
     * 
     * @param string $expoPushToken Expo push token (starts with ExponentPushToken or ExpoPushToken)
     * @param string $title Notification title
     * @param string $body Notification body
     * @param array $data Additional data payload
     * @return bool
     */
    public function sendToExpoToken(string $expoPushToken, string $title, string $body, array $data = []): bool
    {
        try {
            // Expo push tokens need to be sent via Expo Push API, not directly via FCM
            // But if you want to use FCM v1, you need to convert Expo token to FCM token
            // For now, we'll use Expo Push API for Expo tokens
            
            // If you have native FCM tokens (not Expo tokens), use this:
            // return $this->sendToFcmToken($fcmToken, $title, $body, $data);
            
            // For Expo tokens, use Expo Push API
            return $this->sendViaExpoAPI($expoPushToken, $title, $body, $data);
            
        } catch (\Exception $e) {
            Log::error('Failed to send push notification: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Send notification via Expo Push API (for Expo push tokens)
     */
    private function sendViaExpoAPI(string $expoPushToken, string $title, string $body, array $data = []): bool
    {
        try {
            $url = 'https://exp.host/--/api/v2/push/send';
            
            $payload = [
                'to' => $expoPushToken,
                'title' => $title,
                'body' => $body,
                'data' => $data,
                'sound' => 'default',
                'priority' => 'high',
                'channelId' => 'default',
            ];

            $ch = curl_init($url);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                'Content-Type: application/json',
                'Accept: application/json',
            ]);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            
            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200) {
                Log::info('Push notification sent successfully', ['token' => substr($expoPushToken, 0, 20) . '...']);
                return true;
            } else {
                Log::error('Failed to send push notification', [
                    'http_code' => $httpCode,
                    'response' => $response
                ]);
                return false;
            }
        } catch (\Exception $e) {
            Log::error('Exception sending push notification: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Send notification to native FCM token (if you migrate to native FCM tokens)
     */
    public function sendToFcmToken(string $fcmToken, string $title, string $body, array $data = []): bool
    {
        try {
            $message = CloudMessage::withTarget('token', $fcmToken)
                ->withNotification(Notification::create($title, $body))
                ->withData($data)
                ->withAndroidConfig(
                    AndroidConfig::fromArray([
                        'priority' => 'high',
                        'notification' => [
                            'sound' => 'default',
                            'channel_id' => 'default',
                        ],
                    ])
                )
                ->withApnsConfig(
                    ApnsConfig::fromArray([
                        'headers' => [
                            'apns-priority' => '10',
                        ],
                        'payload' => [
                            'aps' => [
                                'sound' => 'default',
                                'badge' => $data['badge'] ?? 0,
                            ],
                        ],
                    ])
                );

            $this->messaging->send($message);
            
            Log::info('FCM v1 notification sent successfully', ['token' => substr($fcmToken, 0, 20) . '...']);
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to send FCM v1 notification: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Send new message notification (your existing method)
     */
    public function sendNewMessageNotification($message, $conversation): bool
    {
        try {
            // Get receiver's FCM token
            $receiverId = $conversation['is_group'] 
                ? null 
                : ($conversation['user_id'] ?? $conversation['id']);
            
            if (!$receiverId) {
                // For groups, get all members' tokens
                return $this->sendGroupMessageNotification($message, $conversation);
            }

            $receiver = User::find($receiverId);
            if (!$receiver || !$receiver->fcm_token) {
                Log::warning('User has no FCM token', ['user_id' => $receiverId]);
                return false;
            }

            $senderName = $message->sender->name ?? 'Someone';
            $title = $conversation['is_group'] 
                ? $conversation['name'] 
                : $senderName;
            
            $body = $message->message 
                ? (strlen($message->message) > 100 ? substr($message->message, 0, 100) . '...' : $message->message)
                : ($message->attachments && count($message->attachments) > 0 ? 'Sent an attachment' : 'New message');

            $data = [
                'type' => 'new_message',
                'conversation_id' => $conversation['id'],
                'message_id' => $message->id,
                'is_group' => $conversation['is_group'] ?? false,
                'sender_id' => $message->sender_id,
                'sender_name' => $senderName,
            ];

            return $this->sendToExpoToken($receiver->fcm_token, $title, $body, $data);
            
        } catch (\Exception $e) {
            Log::error('Failed to send new message notification: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Send notification to all group members
     */
    private function sendGroupMessageNotification($message, $conversation): bool
    {
        try {
            $groupId = $conversation['id'];
            $group = \App\Models\Group::with('members')->find($groupId);
            
            if (!$group || !$group->members) {
                return false;
            }

            $senderName = $message->sender->name ?? 'Someone';
            $title = $conversation['name'] ?? 'Group';
            
            $body = $message->message 
                ? (strlen($message->message) > 100 ? substr($message->message, 0, 100) . '...' : $message->message)
                : ($message->attachments && count($message->attachments) > 0 ? 'Sent an attachment' : 'New message');

            $data = [
                'type' => 'new_message',
                'conversation_id' => $groupId,
                'message_id' => $message->id,
                'is_group' => true,
                'sender_id' => $message->sender_id,
                'sender_name' => $senderName,
            ];

            $successCount = 0;
            foreach ($group->members as $member) {
                if ($member->id !== $message->sender_id && $member->fcm_token) {
                    if ($this->sendToExpoToken($member->fcm_token, $title, $body, $data)) {
                        $successCount++;
                    }
                }
            }

            Log::info("Group notification sent to {$successCount} members", ['group_id' => $groupId]);
            return $successCount > 0;
            
        } catch (\Exception $e) {
            Log::error('Failed to send group notification: ' . $e->getMessage());
            return false;
        }
    }
}
```

---

## ⚙️ Step 4: Add Firebase Configuration

Create `config/firebase.php`:

```php
<?php

return [
    'project_id' => env('FIREBASE_PROJECT_ID', 'chat-32491'),
    
    // Option A: File path
    'credentials_path' => env('FIREBASE_CREDENTIALS_PATH', 'storage/app/firebase-service-account.json'),
    
    // Option B: Base64 encoded (for production)
    'credentials_base64' => env('FIREBASE_CREDENTIALS_BASE64'),
];
```

---

## 🔄 Step 5: Update .env File

Add to your Laravel `.env`:

```env
# Firebase FCM v1 Configuration
FIREBASE_PROJECT_ID=chat-32491
FIREBASE_CREDENTIALS_PATH=storage/app/firebase-service-account.json

# OR use base64 for production:
# FIREBASE_CREDENTIALS_BASE64=<base64_encoded_json>
```

---

## 📝 Step 6: Copy Service Account JSON to Backend

```bash
# From your frontend directory
cp chat-32491-firebase-adminsdk-fbsvc-ba1cc2d1c6.json /path/to/laravel/backend/storage/app/firebase-service-account.json
```

**Important:** Add `storage/app/firebase-service-account.json` to `.gitignore`:

```gitignore
# Firebase credentials
storage/app/firebase-service-account.json
```

---

## ✅ Step 7: Test the Migration

Create a test route in `routes/api.php`:

```php
Route::post('/test-fcm-v1', function () {
    try {
        $pushService = new \App\Services\PushNotificationService();
        
        // Test with your Expo push token
        $expoToken = request('token'); // Get from your app
        $result = $pushService->sendToExpoToken(
            $expoToken,
            'Test Notification',
            'FCM v1 is working!',
            ['test' => true]
        );
        
        return response()->json([
            'success' => $result,
            'message' => $result ? 'Notification sent successfully' : 'Failed to send notification'
        ]);
    } catch (\Exception $e) {
        return response()->json([
            'success' => false,
            'error' => $e->getMessage()
        ], 500);
    }
})->middleware('auth:sanctum');
```

---

## 🗑️ Step 8: Remove Legacy FCM Code

After confirming FCM v1 works:

1. **Remove legacy server key** from Firebase Console:
   - Go to Firebase Console → Project Settings → Cloud Messaging
   - Delete the legacy server key

2. **Remove legacy code** from your backend:
   - Delete any code using `FCM_SERVER_KEY`
   - Remove legacy FCM API endpoints
   - Update any documentation

3. **Update environment variables**:
   - Remove `FCM_SERVER_KEY` from `.env`
   - Keep only FCM v1 configuration

---

## 📊 Current vs New Implementation

### Legacy FCM (Old - Don't Use)
```php
// ❌ OLD - Legacy API (deprecated)
$url = 'https://fcm.googleapis.com/fcm/send';
$headers = [
    'Authorization: key=' . env('FCM_SERVER_KEY'),
    'Content-Type: application/json',
];
```

### FCM v1 (New - Use This)
```php
// ✅ NEW - FCM v1 API
$factory = (new Factory())
    ->withServiceAccount($credentialsPath);
$messaging = $factory->createMessaging();
$messaging->send($message);
```

---

## 🎯 Key Differences

| Feature | Legacy FCM | FCM v1 |
|---------|-----------|--------|
| **Authentication** | Server Key | OAuth2 Token (Service Account) |
| **Endpoint** | `fcm.googleapis.com/fcm/send` | `fcm.googleapis.com/v1/projects/{project}/messages:send` |
| **Security** | Long-lived key | Short-lived tokens |
| **Status** | ❌ Deprecated & Shut Down | ✅ Current Standard |

---

## 🔒 Security Best Practices

1. **Never commit service account JSON to Git**
   - Add to `.gitignore`
   - Use environment variables in production

2. **Use different credentials for dev/prod**
   - Create separate Firebase projects if needed
   - Or use environment-specific service accounts

3. **Rotate credentials periodically**
   - Generate new service account keys
   - Update credentials in all environments

---

## ✅ Migration Checklist

- [ ] Install `kreait/firebase-php` package
- [ ] Copy service account JSON to Laravel storage
- [ ] Create/update `PushNotificationService.php`
- [ ] Add Firebase configuration to `config/firebase.php`
- [ ] Update `.env` with Firebase credentials
- [ ] Test notification sending
- [ ] Remove legacy FCM server key from Firebase
- [ ] Remove legacy FCM code from backend
- [ ] Update documentation

---

## 🚀 Next Steps

1. **Test thoroughly** before removing legacy code
2. **Monitor logs** for any FCM errors
3. **Update production** after testing in development
4. **Delete legacy server key** once v1 is confirmed working

---

## 📚 Resources

- [Firebase Admin SDK for PHP](https://firebase-php.readthedocs.io/)
- [FCM v1 Migration Guide](https://firebase.google.com/docs/cloud-messaging/migrate-v1)
- [Expo Push Notifications](https://docs.expo.dev/push-notifications/overview/)

---

**Status:** Ready for Migration  
**Last Updated:** FCM v1 Migration Guide


