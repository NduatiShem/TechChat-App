# 🧪 Testing Push Notifications Locally

## ✅ Multiple Ways to Test

### Option 1: Test with Expo Push API (Works in Development) ⭐ **Easiest**

Your app uses **Expo push tokens**, which work in development builds without needing FCM v1 credentials!

#### Step 1: Get Your Expo Push Token

1. **Open your app** (dev build or Expo Go)
2. **Navigate to API Test screen** (if you have it)
3. **Or add this to any screen temporarily:**

```typescript
import { useNotifications } from '@/context/NotificationContext';

const { expoPushToken, getExpoPushToken } = useNotifications();

// Get token
const token = await getExpoPushToken();
console.log('Expo Push Token:', token);
```

#### Step 2: Test via Expo's Push Notification Tool

**Use Expo's web tool:**
1. Go to: https://expo.dev/notifications
2. Paste your Expo push token
3. Enter title and message
4. Click "Send a Notification"
5. **You should receive it on your device!**

#### Step 3: Test via Backend API

**Create a test endpoint in your Laravel backend:**

```php
// routes/api.php
Route::post('/test-push', function (Request $request) {
    $validated = $request->validate([
        'fcm_token' => 'required|string',
        'title' => 'required|string',
        'body' => 'required|string',
    ]);
    
    $pushService = new \App\Services\PushNotificationService();
    
    // Check if it's an Expo token
    $token = $validated['fcm_token'];
    if (strpos($token, 'ExponentPushToken') === 0 || strpos($token, 'ExpoPushToken') === 0) {
        $result = $pushService->sendExpoNotification(
            $token,
            $validated['title'],
            $validated['body'],
            ['test' => true, 'timestamp' => now()->toISOString()]
        );
    } else {
        // Native FCM token - use FCM v1
        $result = $pushService->sendNotification(
            $token,
            $validated['title'],
            $validated['body'],
            ['test' => true, 'timestamp' => now()->toISOString()]
        );
    }
    
    return response()->json($result);
})->middleware('auth:sanctum'); // Remove middleware for testing
```

**Test it:**
```bash
curl -X POST http://192.168.100.25:8000/api/test-push \
  -H "Content-Type: application/json" \
  -d '{
    "fcm_token": "ExponentPushToken[YOUR_TOKEN_HERE]",
    "title": "Test Notification",
    "body": "This is a test from backend!"
  }'
```

---

### Option 2: Test Backend Service Directly (PHP)

**Create a test script:**

```php
// test-push.php (in Laravel root)
<?php

require __DIR__.'/vendor/autoload.php';

$app = require_once __DIR__.'/bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Services\PushNotificationService;

$pushService = new PushNotificationService();

// Replace with your actual Expo push token
$expoToken = 'ExponentPushToken[YOUR_TOKEN_HERE]';

echo "Testing Expo Push Notification...\n";

$result = $pushService->sendExpoNotification(
    $expoToken,
    'Test from Backend',
    'This is a test notification sent directly from PHP!',
    [
        'type' => 'test',
        'timestamp' => date('Y-m-d H:i:s')
    ]
);

echo "Result:\n";
print_r($result);
```

**Run it:**
```bash
php test-push.php
```

---

### Option 3: Test via Your App's API Test Component

You already have `ApiTest.tsx` with a test function!

1. **Open the app**
2. **Navigate to API Test screen**
3. **Get Expo Push Token** (if not already available)
4. **Click "Test Push Notification"**
5. **Check your device** - notification should appear!

---

### Option 4: Test FCM v1 (Requires Native Build)

**Note:** FCM v1 only works with native builds that have FCM credentials. You can test the backend service, but the app needs a build with FCM v1 credentials.

#### Test Backend FCM v1 Service:

```php
// test-fcm-v1.php
<?php

require __DIR__.'/vendor/autoload.php';

$app = require_once __DIR__.'/bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Services\PushNotificationService;

$pushService = new PushNotificationService();

// This would be a native FCM token (not Expo token)
// You'll get this after building with FCM v1 credentials
$fcmToken = 'YOUR_NATIVE_FCM_TOKEN_HERE';

echo "Testing FCM v1 Notification...\n";

$result = $pushService->sendNotification(
    $fcmToken,
    'Test FCM v1',
    'This is a test from FCM v1!',
    [
        'type' => 'test',
        'timestamp' => date('Y-m-d H:i:s')
    ]
);

echo "Result:\n";
print_r($result);
```

---

## 🎯 Quick Test Checklist

### ✅ Test Expo Push (Works Now)

- [ ] Get Expo push token from app
- [ ] Test via Expo web tool: https://expo.dev/notifications
- [ ] Test via backend API endpoint
- [ ] Verify notification appears on device

### ✅ Test Backend Service

- [ ] Create test endpoint in Laravel
- [ ] Test with Expo token
- [ ] Check Laravel logs for success/errors
- [ ] Verify notification delivery

### ⏳ Test FCM v1 (After Build)

- [ ] Build app with FCM v1 credentials
- [ ] Get native FCM token (different from Expo token)
- [ ] Test backend FCM v1 service
- [ ] Verify notification via FCM v1

---

## 🔍 Debugging Tips

### Check Expo Push Token

```typescript
// In your app
const { expoPushToken } = useNotifications();
console.log('Token:', expoPushToken);
```

### Check Backend Logs

```bash
# Laravel logs
tail -f storage/logs/laravel.log | grep -i "notification\|expo\|fcm"
```

### Check Notification Permissions

```typescript
import * as Notifications from 'expo-notifications';

const { status } = await Notifications.getPermissionsAsync();
console.log('Permission status:', status);
```

### Test Notification Handler

Your app should show notifications even when in foreground. Check `NotificationContext.tsx` - it's configured to show notifications.

---

## 📱 Testing on Different Devices

### Physical Device (Recommended)
- ✅ Works with Expo push tokens
- ✅ Works with FCM v1 (after build)
- ✅ Real notification experience

### Simulator/Emulator
- ⚠️ Limited push notification support
- ⚠️ May not receive notifications properly
- ✅ Can test token generation

---

## 🚀 Recommended Testing Flow

1. **Start with Expo Push API** (easiest, works now)
   - Get token from app
   - Test via Expo web tool
   - Test via backend API

2. **Test Backend Service**
   - Create test endpoint
   - Verify Expo notifications work
   - Check logs

3. **After Building with FCM v1**
   - Build production app
   - Get native FCM token
   - Test FCM v1 notifications
   - Compare with Expo notifications

---

## ✅ Success Indicators

### Expo Push Working:
- ✅ Token generated successfully
- ✅ Notification appears on device
- ✅ Backend logs show "Expo notification sent successfully"
- ✅ Notification handler in app receives it

### FCM v1 Working (After Build):
- ✅ Native FCM token generated
- ✅ Backend logs show "FCM v1 notification sent successfully"
- ✅ Notification appears on device
- ✅ Firebase console shows delivery

---

## 🆘 Troubleshooting

### "No Expo push token available"
- Make sure you're on a physical device
- Check notification permissions are granted
- Verify you're not in Expo Go (use dev build)

### "Firebase not initialized"
- This is expected if you haven't built with FCM credentials yet
- Expo push tokens work without Firebase
- FCM v1 requires a build with credentials

### "Notification not appearing"
- Check notification permissions
- Verify token is correct
- Check device notification settings
- Look at backend logs for errors

---

**Start with Option 1 (Expo Push API) - it's the easiest and works right now!** 🎉

