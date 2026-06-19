<?php

/**
 * Complete PushNotificationService Example for FCM v1
 * 
 * Copy this to: app/Services/PushNotificationService.php
 * 
 * Make sure to:
 * 1. Install: composer require kreait/firebase-php
 * 2. Copy service account JSON to storage/app/firebase-service-account.json
 * 3. Add FIREBASE_PROJECT_ID to .env
 */

namespace App\Services;

use Kreait\Firebase\Factory;
use Kreait\Firebase\Messaging\CloudMessage;
use Kreait\Firebase\Messaging\Notification;
use Kreait\Firebase\Messaging\AndroidConfig;
use Kreait\Firebase\Messaging\ApnsConfig;
use Illuminate\Support\Facades\Log;
use App\Models\User;
use App\Models\Group;

class PushNotificationService
{
    private $messaging;
    private $projectId;
    private $initialized = false;

    public function __construct()
    {
        $this->projectId = config('firebase.project_id', env('FIREBASE_PROJECT_ID', 'chat-32491'));
        $this->initializeFirebase();
    }

    /**
     * Initialize Firebase Messaging with FCM v1
     */
    private function initializeFirebase(): void
    {
        if ($this->initialized) {
            return;
        }

        try {
            $factory = new Factory();
            
            // Try different methods to load credentials
            $credentialsLoaded = false;
            
            // Method 1: From config file path
            if (config('firebase.credentials_path')) {
                $credentialsPath = base_path(config('firebase.credentials_path'));
                if (file_exists($credentialsPath)) {
                    $factory = $factory->withServiceAccount($credentialsPath);
                    $credentialsLoaded = true;
                    Log::info('Firebase credentials loaded from file', ['path' => $credentialsPath]);
                }
            }
            
            // Method 2: From base64 encoded env variable
            if (!$credentialsLoaded && config('firebase.credentials_base64')) {
                $credentialsJson = base64_decode(config('firebase.credentials_base64'));
                if ($credentialsJson) {
                    $factory = $factory->withServiceAccount($credentialsJson);
                    $credentialsLoaded = true;
                    Log::info('Firebase credentials loaded from base64 env variable');
                }
            }
            
            // Method 3: Default path
            if (!$credentialsLoaded) {
                $defaultPath = storage_path('app/firebase-service-account.json');
                if (file_exists($defaultPath)) {
                    $factory = $factory->withServiceAccount($defaultPath);
                    $credentialsLoaded = true;
                    Log::info('Firebase credentials loaded from default path', ['path' => $defaultPath]);
                }
            }
            
            if (!$credentialsLoaded) {
                throw new \Exception('Firebase credentials not found. Please configure FIREBASE_CREDENTIALS_PATH or FIREBASE_CREDENTIALS_BASE64');
            }
            
            $this->messaging = $factory->createMessaging();
            $this->initialized = true;
            
            Log::info('Firebase Messaging initialized successfully', ['project_id' => $this->projectId]);
            
        } catch (\Exception $e) {
            Log::error('Failed to initialize Firebase: ' . $e->getMessage());
            $this->initialized = false;
            // Don't throw - allow app to continue without notifications
        }
    }

    /**
     * Send push notification to Expo push token
     * 
     * Note: Expo tokens are sent via Expo Push API, not directly via FCM
     * FCM v1 is used for native FCM tokens (if you migrate to native tokens later)
     */
    public function sendToExpoToken(string $expoPushToken, string $title, string $body, array $data = []): bool
    {
        try {
            // Validate token format
            if (empty($expoPushToken) || !preg_match('/^(ExponentPushToken|ExpoPushToken)[\/][a-zA-Z0-9_-]+$/', $expoPushToken)) {
                Log::warning('Invalid Expo push token format', ['token' => substr($expoPushToken, 0, 20) . '...']);
                return false;
            }

            // Use Expo Push API for Expo tokens
            return $this->sendViaExpoAPI($expoPushToken, $title, $body, $data);
            
        } catch (\Exception $e) {
            Log::error('Failed to send push notification to Expo token: ' . $e->getMessage(), [
                'token_preview' => substr($expoPushToken, 0, 20) . '...'
            ]);
            return false;
        }
    }

    /**
     * Send notification via Expo Push API
     * This is the correct way to send to Expo push tokens
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

            // Add badge count if provided
            if (isset($data['badge'])) {
                $payload['badge'] = (int)$data['badge'];
            }

            $ch = curl_init($url);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                'Content-Type: application/json',
                'Accept: application/json',
                'Accept-Encoding: gzip, deflate',
            ]);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);
            
            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlError = curl_error($ch);
            curl_close($ch);

            if ($curlError) {
                Log::error('cURL error sending Expo push notification', ['error' => $curlError]);
                return false;
            }

            if ($httpCode === 200) {
                $responseData = json_decode($response, true);
                if (isset($responseData['data']['status']) && $responseData['data']['status'] === 'ok') {
                    Log::info('Expo push notification sent successfully', [
                        'token_preview' => substr($expoPushToken, 0, 20) . '...',
                        'title' => $title
                    ]);
                    return true;
                } else {
                    Log::warning('Expo push notification returned non-ok status', [
                        'response' => $responseData
                    ]);
                    return false;
                }
            } else {
                Log::error('Failed to send Expo push notification', [
                    'http_code' => $httpCode,
                    'response' => $response
                ]);
                return false;
            }
        } catch (\Exception $e) {
            Log::error('Exception sending Expo push notification: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Send notification to native FCM token using FCM v1 API
     * Use this if you migrate from Expo tokens to native FCM tokens
     */
    public function sendToFcmToken(string $fcmToken, string $title, string $body, array $data = []): bool
    {
        if (!$this->initialized) {
            Log::error('Firebase not initialized, cannot send FCM notification');
            return false;
        }

        try {
            $message = CloudMessage::withTarget('token', $fcmToken)
                ->withNotification(Notification::create($title, $body))
                ->withData($data);

            // Android-specific configuration
            $androidConfig = AndroidConfig::fromArray([
                'priority' => 'high',
                'notification' => [
                    'sound' => 'default',
                    'channel_id' => 'default',
                    'click_action' => 'FLUTTER_NOTIFICATION_CLICK',
                ],
            ]);
            $message = $message->withAndroidConfig($androidConfig);

            // iOS-specific configuration
            $apnsConfig = ApnsConfig::fromArray([
                'headers' => [
                    'apns-priority' => '10',
                ],
                'payload' => [
                    'aps' => [
                        'sound' => 'default',
                        'badge' => $data['badge'] ?? 0,
                        'alert' => [
                            'title' => $title,
                            'body' => $body,
                        ],
                    ],
                ],
            ]);
            $message = $message->withApnsConfig($apnsConfig);

            $this->messaging->send($message);
            
            Log::info('FCM v1 notification sent successfully', [
                'token_preview' => substr($fcmToken, 0, 20) . '...',
                'title' => $title
            ]);
            return true;
            
        } catch (\Kreait\Firebase\Exception\Messaging\InvalidArgument $e) {
            Log::error('Invalid FCM message: ' . $e->getMessage());
            return false;
        } catch (\Kreait\Firebase\Exception\Messaging\NotFound $e) {
            Log::warning('FCM token not found (user may have uninstalled app): ' . $e->getMessage());
            return false;
        } catch (\Exception $e) {
            Log::error('Failed to send FCM v1 notification: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Send new message notification (main method used by MessageController)
     */
    public function sendNewMessageNotification($message, $conversation): bool
    {
        try {
            if ($conversation['is_group'] ?? false) {
                return $this->sendGroupMessageNotification($message, $conversation);
            } else {
                return $this->sendIndividualMessageNotification($message, $conversation);
            }
        } catch (\Exception $e) {
            Log::error('Failed to send new message notification: ' . $e->getMessage(), [
                'message_id' => $message->id ?? null,
                'conversation_id' => $conversation['id'] ?? null
            ]);
            return false;
        }
    }

    /**
     * Send notification for individual conversation
     */
    private function sendIndividualMessageNotification($message, $conversation): bool
    {
        try {
            $receiverId = $conversation['user_id'] ?? $conversation['id'] ?? null;
            
            if (!$receiverId) {
                Log::warning('No receiver ID found in conversation', ['conversation' => $conversation]);
                return false;
            }

            $receiver = User::find($receiverId);
            if (!$receiver) {
                Log::warning('Receiver user not found', ['user_id' => $receiverId]);
                return false;
            }

            if (!$receiver->fcm_token) {
                Log::debug('User has no FCM token', ['user_id' => $receiverId]);
                return false;
            }

            // Don't send notification if user is sending to themselves
            if ($message->sender_id == $receiverId) {
                return false;
            }

            $senderName = $message->sender->name ?? 'Someone';
            $title = $senderName;
            
            $body = $this->formatMessageBody($message);

            $data = [
                'type' => 'new_message',
                'conversation_id' => $conversation['id'],
                'message_id' => $message->id,
                'is_group' => false,
                'sender_id' => $message->sender_id,
                'sender_name' => $senderName,
            ];

            return $this->sendToExpoToken($receiver->fcm_token, $title, $body, $data);
            
        } catch (\Exception $e) {
            Log::error('Failed to send individual message notification: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Send notification to all group members
     */
    private function sendGroupMessageNotification($message, $conversation): bool
    {
        try {
            $groupId = $conversation['id'] ?? null;
            
            if (!$groupId) {
                Log::warning('No group ID found in conversation', ['conversation' => $conversation]);
                return false;
            }

            $group = Group::with('members')->find($groupId);
            
            if (!$group || !$group->members || $group->members->isEmpty()) {
                Log::warning('Group not found or has no members', ['group_id' => $groupId]);
                return false;
            }

            $senderName = $message->sender->name ?? 'Someone';
            $title = $conversation['name'] ?? $group->name ?? 'Group';
            
            $body = $this->formatMessageBody($message);

            $data = [
                'type' => 'new_message',
                'conversation_id' => $groupId,
                'message_id' => $message->id,
                'is_group' => true,
                'sender_id' => $message->sender_id,
                'sender_name' => $senderName,
            ];

            $successCount = 0;
            $totalMembers = 0;
            
            foreach ($group->members as $member) {
                // Skip sender
                if ($member->id === $message->sender_id) {
                    continue;
                }
                
                $totalMembers++;
                
                if ($member->fcm_token) {
                    if ($this->sendToExpoToken($member->fcm_token, $title, $body, $data)) {
                        $successCount++;
                    }
                } else {
                    Log::debug('Group member has no FCM token', [
                        'member_id' => $member->id,
                        'group_id' => $groupId
                    ]);
                }
            }

            Log::info("Group notification sent", [
                'group_id' => $groupId,
                'sent' => $successCount,
                'total' => $totalMembers
            ]);
            
            return $successCount > 0;
            
        } catch (\Exception $e) {
            Log::error('Failed to send group notification: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Format message body for notification
     */
    private function formatMessageBody($message): string
    {
        if ($message->message) {
            $text = $message->message;
            return strlen($text) > 100 ? substr($text, 0, 100) . '...' : $text;
        }
        
        if ($message->attachments && count($message->attachments) > 0) {
            $attachment = $message->attachments[0];
            $mimeType = $attachment->mime ?? '';
            
            if (str_starts_with($mimeType, 'image/')) {
                return '📷 Sent a photo';
            } elseif (str_starts_with($mimeType, 'video/')) {
                return '🎥 Sent a video';
            } elseif (str_starts_with($mimeType, 'audio/')) {
                return '🎤 Sent a voice message';
            } else {
                return '📎 Sent an attachment';
            }
        }
        
        return 'New message';
    }
}


