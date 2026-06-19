<?php

namespace App\Services;

use Kreait\Firebase\Factory;
use Kreait\Firebase\Messaging\CloudMessage;
use Kreait\Firebase\Messaging\Notification;
use Kreait\Firebase\Messaging\AndroidConfig;
use Kreait\Firebase\Messaging\ApnsConfig;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use App\Models\User;
use App\Models\Group;

class PushNotificationService
{
    private $messaging;
    private $initialized = false;

    public function __construct()
    {
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
            
            // Try to load credentials from different sources
            $credentialsLoaded = false;
            
            // Method 1: From config file path
            if (config('firebase.credentials_path')) {
                $credentialsPath = base_path(config('firebase.credentials_path'));
                if (file_exists($credentialsPath)) {
                    $factory = $factory->withServiceAccount($credentialsPath);
                    $credentialsLoaded = true;
                    Log::info('Firebase credentials loaded from config path', ['path' => $credentialsPath]);
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
            
            // Method 3: Default path (storage/app/firebase-service-account.json)
            if (!$credentialsLoaded) {
                $defaultPath = storage_path('app/firebase-service-account.json');
                if (file_exists($defaultPath)) {
                    $factory = $factory->withServiceAccount($defaultPath);
                    $credentialsLoaded = true;
                    Log::info('Firebase credentials loaded from default path', ['path' => $defaultPath]);
                }
            }
            
            if (!$credentialsLoaded) {
                Log::warning('Firebase credentials not found. FCM v1 notifications will not work. Using Expo API only.');
                $this->initialized = false;
                return;
            }
            
            $this->messaging = $factory->createMessaging();
            $this->initialized = true;
            
            Log::info('Firebase Messaging (FCM v1) initialized successfully');
            
        } catch (\Exception $e) {
            Log::error('Failed to initialize Firebase: ' . $e->getMessage());
            $this->initialized = false;
            // Don't throw - allow app to continue with Expo API only
        }
    }

    /**
     * Send FCM v1 notification (for native FCM tokens)
     * This replaces the old legacy FCM method
     */
    public function sendNotification($fcmToken, $title, $body, $data = [])
    {
        if (!$this->initialized) {
            Log::warning('Firebase not initialized. Cannot send FCM v1 notification.');
            return ['success' => false, 'error' => 'Firebase not initialized'];
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
            
            return ['success' => true, 'method' => 'fcm_v1'];
            
        } catch (\Kreait\Firebase\Exception\Messaging\InvalidArgument $e) {
            Log::error('Invalid FCM message: ' . $e->getMessage());
            return ['success' => false, 'error' => 'Invalid FCM message: ' . $e->getMessage()];
        } catch (\Kreait\Firebase\Exception\Messaging\NotFound $e) {
            Log::warning('FCM token not found (user may have uninstalled app): ' . $e->getMessage());
            return ['success' => false, 'error' => 'FCM token not found'];
        } catch (\Exception $e) {
            Log::error('FCM v1 notification error: ' . $e->getMessage());
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * Send Expo push notification (for Expo tokens)
     * This method remains unchanged - it's already correct
     */
    public function sendExpoNotification($expoToken, $title, $body, $data = [])
    {
        try {
            $payload = [
                'to' => $expoToken,
                'title' => $title,
                'body' => $body,
                'data' => $data,
                'sound' => 'default',
                'priority' => 'high',
                'channelId' => 'default',
            ];

            // Add badge if provided
            if (isset($data['badge'])) {
                $payload['badge'] = (int)$data['badge'];
            }

            $response = Http::timeout(10)->post('https://exp.host/--/api/v2/push/send', $payload);

            if ($response->successful()) {
                $responseData = $response->json();
                if (isset($responseData['data']['status']) && $responseData['data']['status'] === 'ok') {
                    Log::info('Expo notification sent successfully', [
                        'token_preview' => substr($expoToken, 0, 20) . '...',
                        'title' => $title
                    ]);
                    return ['success' => true, 'response' => $responseData, 'method' => 'expo'];
                } else {
                    Log::warning('Expo notification returned non-ok status', [
                        'response' => $responseData
                    ]);
                    return ['success' => false, 'error' => 'Expo returned non-ok status', 'response' => $responseData];
                }
            } else {
                Log::error('Expo notification failed', [
                    'status' => $response->status(),
                    'body' => $response->body()
                ]);
                return ['success' => false, 'error' => 'Expo request failed', 'status' => $response->status()];
            }
        } catch (\Exception $e) {
            Log::error('Expo notification error: ' . $e->getMessage());
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * Send new message notification
     * Updated to handle both individual and group conversations properly
     */
    public function sendNewMessageNotification($message, $conversation)
    {
        try {
            $sender = $message->sender;
            $senderName = $sender->name ?? 'Someone';
            
            // Determine if it's a group conversation
            $isGroup = $conversation['is_group'] ?? false;
            
            if ($isGroup) {
                return $this->sendGroupMessageNotification($message, $conversation, $senderName);
            } else {
                return $this->sendIndividualMessageNotification($message, $conversation, $senderName);
            }
        } catch (\Exception $e) {
            Log::error('Failed to send new message notification: ' . $e->getMessage(), [
                'message_id' => $message->id ?? null,
                'conversation_id' => $conversation['id'] ?? null
            ]);
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * Send notification for individual conversation
     */
    private function sendIndividualMessageNotification($message, $conversation, $senderName)
    {
        try {
            // Get receiver ID from conversation
            $receiverId = $conversation['user_id'] ?? $conversation['id'] ?? null;
            
            if (!$receiverId) {
                Log::warning('No receiver ID found in conversation', ['conversation' => $conversation]);
                return ['success' => false, 'error' => 'No receiver ID'];
            }

            $receiver = User::find($receiverId);
            if (!$receiver) {
                Log::warning('Receiver user not found', ['user_id' => $receiverId]);
                return ['success' => false, 'error' => 'Receiver not found'];
            }

            // Don't send notification if user is sending to themselves
            if ($message->sender_id == $receiverId) {
                return ['success' => false, 'error' => 'Cannot send notification to self'];
            }

            $fcmToken = $receiver->fcm_token ?? null;
            if (!$fcmToken) {
                Log::info('No FCM token found for user', ['user_id' => $receiverId]);
                return ['success' => false, 'error' => 'No FCM token'];
            }

            $title = $senderName;
            $body = $this->formatMessageBody($message);

            $data = [
                'message_id' => $message->id,
                'conversation_id' => $conversation['id'] ?? null,
                'type' => 'new_message',
                'sender_id' => $message->sender_id,
                'sender_name' => $senderName,
                'is_group' => false,
            ];

            // Check if it's an Expo token or native FCM token
            if (strpos($fcmToken, 'ExponentPushToken') === 0 || strpos($fcmToken, 'ExpoPushToken') === 0) {
                return $this->sendExpoNotification($fcmToken, $title, $body, $data);
            } else {
                // Native FCM token - use FCM v1
                return $this->sendNotification($fcmToken, $title, $body, $data);
            }
        } catch (\Exception $e) {
            Log::error('Failed to send individual message notification: ' . $e->getMessage());
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * Send notification to all group members
     */
    private function sendGroupMessageNotification($message, $conversation, $senderName)
    {
        try {
            $groupId = $conversation['id'] ?? null;
            
            if (!$groupId) {
                Log::warning('No group ID found in conversation', ['conversation' => $conversation]);
                return ['success' => false, 'error' => 'No group ID'];
            }

            $group = Group::with('members')->find($groupId);
            
            if (!$group || !$group->members || $group->members->isEmpty()) {
                Log::warning('Group not found or has no members', ['group_id' => $groupId]);
                return ['success' => false, 'error' => 'Group not found or empty'];
            }

            $title = $conversation['name'] ?? $group->name ?? 'Group';
            $body = $this->formatMessageBody($message);

            $data = [
                'message_id' => $message->id,
                'conversation_id' => $groupId,
                'type' => 'new_message',
                'sender_id' => $message->sender_id,
                'sender_name' => $senderName,
                'is_group' => true,
            ];

            $successCount = 0;
            $totalMembers = 0;
            $errors = [];

            foreach ($group->members as $member) {
                // Skip sender
                if ($member->id === $message->sender_id) {
                    continue;
                }
                
                $totalMembers++;
                
                $fcmToken = $member->fcm_token ?? null;
                if (!$fcmToken) {
                    Log::debug('Group member has no FCM token', [
                        'member_id' => $member->id,
                        'group_id' => $groupId
                    ]);
                    continue;
                }

                // Send notification based on token type
                $result = null;
                if (strpos($fcmToken, 'ExponentPushToken') === 0 || strpos($fcmToken, 'ExpoPushToken') === 0) {
                    $result = $this->sendExpoNotification($fcmToken, $title, $body, $data);
                } else {
                    $result = $this->sendNotification($fcmToken, $title, $body, $data);
                }

                if ($result && ($result['success'] ?? false)) {
                    $successCount++;
                } else {
                    $errors[] = [
                        'member_id' => $member->id,
                        'error' => $result['error'] ?? 'Unknown error'
                    ];
                }
            }

            Log::info("Group notification sent", [
                'group_id' => $groupId,
                'sent' => $successCount,
                'total' => $totalMembers,
                'errors' => count($errors)
            ]);

            return [
                'success' => $successCount > 0,
                'sent_count' => $successCount,
                'total_count' => $totalMembers,
                'errors' => $errors
            ];
            
        } catch (\Exception $e) {
            Log::error('Failed to send group notification: ' . $e->getMessage());
            return ['success' => false, 'error' => $e->getMessage()];
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


