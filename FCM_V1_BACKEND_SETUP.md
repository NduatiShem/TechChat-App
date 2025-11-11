# 🔧 FCM v1 Backend Setup - Step by Step

## 📋 What Needs to Change

### ✅ Your Controller (`MessageController.php`)
**NO CHANGES NEEDED** - Your controller code is perfect! It already:
- Instantiates `PushNotificationService`
- Handles both individual and group conversations
- Has proper error handling

### 🔄 Your Service (`PushNotificationService.php`)
**NEEDS UPDATE** - Replace with the new version that uses FCM v1

---

## 🚀 Setup Steps

### Step 1: Install Firebase Admin SDK

```bash
cd /path/to/your/laravel/backend
composer require kreait/firebase-php
```

### Step 2: Copy Service Account JSON

```bash
# From your frontend directory (where chat-32491-firebase-adminsdk-fbsvc-ba1cc2d1c6.json is)
cp chat-32491-firebase-adminsdk-fbsvc-ba1cc2d1c6.json /path/to/laravel/backend/storage/app/firebase-service-account.json
```

**Important:** Add to `.gitignore`:
```gitignore
storage/app/firebase-service-account.json
```

### Step 3: Create Firebase Config File

Create `config/firebase.php`:

```php
<?php

return [
    'project_id' => env('FIREBASE_PROJECT_ID', 'chat-32491'),
    'credentials_path' => env('FIREBASE_CREDENTIALS_PATH', 'storage/app/firebase-service-account.json'),
    'credentials_base64' => env('FIREBASE_CREDENTIALS_BASE64'), // Optional: for production
];
```

### Step 4: Update .env File

Add to your Laravel `.env`:

```env
# Firebase FCM v1 Configuration
FIREBASE_PROJECT_ID=chat-32491
FIREBASE_CREDENTIALS_PATH=storage/app/firebase-service-account.json
```

**Remove old FCM legacy config:**
```env
# Remove this line (if it exists):
# FCM_SERVER_KEY=your_old_server_key
```

### Step 5: Replace PushNotificationService

**Backup your current service:**
```bash
cp app/Services/PushNotificationService.php app/Services/PushNotificationService.php.backup
```

**Replace with new version:**
- Copy contents from `PushNotificationService_UPDATED.php`
- Paste into `app/Services/PushNotificationService.php`

### Step 6: Remove Legacy FCM Config

**From `config/services.php`**, remove or comment out:
```php
// Remove this:
'fcm' => [
    'server_key' => env('FCM_SERVER_KEY'),
],
```

---

## ✅ What Changed in the Service

### 1. **Added FCM v1 Support**
- Uses `kreait/firebase-php` package
- Initializes Firebase with service account JSON
- Sends via FCM v1 API instead of legacy API

### 2. **Improved Group Notifications**
- Now properly handles group conversations
- Sends to all group members (except sender)
- Better error handling and logging

### 3. **Better Token Detection**
- Automatically detects Expo tokens vs native FCM tokens
- Routes to appropriate API (Expo API or FCM v1)

### 4. **Enhanced Error Handling**
- Graceful fallback if Firebase not initialized
- Better logging for debugging
- Returns detailed error information

---

## 🧪 Testing

### Test Individual Notification

```bash
# Test endpoint (add to routes/api.php temporarily)
Route::post('/test-notification', function () {
    $pushService = new \App\Services\PushNotificationService();
    
    $user = \App\Models\User::find(request('user_id'));
    if (!$user || !$user->fcm_token) {
        return response()->json(['error' => 'User or token not found'], 404);
    }
    
    $result = $pushService->sendExpoNotification(
        $user->fcm_token,
        'Test Notification',
        'FCM v1 migration test',
        ['test' => true]
    );
    
    return response()->json($result);
})->middleware('auth:sanctum');
```

### Test Group Notification

Your existing code in `MessageController` will automatically test group notifications when you send a message to a group.

---

## 📊 Comparison: Old vs New

### Old (Legacy FCM)
```php
// ❌ OLD - Legacy API (deprecated & shut down)
$response = Http::withHeaders([
    'Authorization' => 'key=' . $serverKey,  // Server key
    'Content-Type' => 'application/json',
])->post('https://fcm.googleapis.com/fcm/send', [
    'to' => $fcmToken,
    'notification' => [...],
]);
```

### New (FCM v1)
```php
// ✅ NEW - FCM v1 API
$factory = (new Factory())
    ->withServiceAccount($credentialsPath);  // Service account JSON
$messaging = $factory->createMessaging();
$messaging->send($message);
```

---

## 🔍 Verification

### Check Logs

```bash
tail -f storage/logs/laravel.log | grep -i firebase
```

You should see:
```
Firebase credentials loaded from default path
Firebase Messaging (FCM v1) initialized successfully
```

### Check Notifications

1. Send a test message
2. Check logs for:
   - `FCM v1 notification sent successfully` (for native tokens)
   - `Expo notification sent successfully` (for Expo tokens)

---

## 🗑️ Cleanup (After Testing)

Once FCM v1 is confirmed working:

1. **Delete legacy server key from Firebase Console:**
   - Go to Firebase Console → Project Settings → Cloud Messaging
   - Delete the legacy server key

2. **Remove from code:**
   - Remove `FCM_SERVER_KEY` from `.env`
   - Remove FCM config from `config/services.php` (if still there)

3. **Update documentation:**
   - Note that you're using FCM v1
   - Update any deployment scripts

---

## ⚠️ Important Notes

1. **Expo Tokens**: Your app currently uses Expo push tokens, which are sent via Expo Push API (not FCM). The FCM v1 setup is ready for when you migrate to native FCM tokens.

2. **Both Work**: The service automatically detects token type:
   - Expo tokens → Expo Push API
   - Native FCM tokens → FCM v1 API

3. **Backward Compatible**: The service maintains the same method signatures, so your controller doesn't need changes.

4. **Error Handling**: If Firebase isn't initialized, the service will still work with Expo API only.

---

## ✅ Migration Checklist

- [ ] Install `kreait/firebase-php` package
- [ ] Copy service account JSON to `storage/app/firebase-service-account.json`
- [ ] Create `config/firebase.php`
- [ ] Update `.env` with Firebase config
- [ ] Replace `PushNotificationService.php` with new version
- [ ] Remove legacy FCM config from `config/services.php`
- [ ] Test individual notifications
- [ ] Test group notifications
- [ ] Verify logs show FCM v1 initialization
- [ ] Delete legacy server key from Firebase Console
- [ ] Remove `FCM_SERVER_KEY` from `.env`

---

## 🆘 Troubleshooting

### Error: "Firebase credentials not found"
- Check that `firebase-service-account.json` exists in `storage/app/`
- Verify file permissions (should be readable)
- Check `.env` has `FIREBASE_CREDENTIALS_PATH` set correctly

### Error: "Firebase not initialized"
- Check logs for initialization errors
- Verify service account JSON is valid
- Make sure `kreait/firebase-php` is installed

### Notifications not sending
- Check if tokens are Expo tokens (should use Expo API)
- Verify Firebase is initialized (check logs)
- Test with a known working token

---

**Status:** Ready to migrate!  
**Your Controller:** ✅ No changes needed  
**Your Service:** 🔄 Replace with updated version


