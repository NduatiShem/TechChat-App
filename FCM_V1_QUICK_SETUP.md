# 🚀 FCM v1 Quick Setup Checklist

## ⚡ Quick Steps

### 1. Install Package
```bash
cd /path/to/laravel/backend
composer require kreait/firebase-php
```

### 2. Copy Service Account JSON
```bash
# From frontend directory
cp chat-32491-firebase-adminsdk-fbsvc-ba1cc2d1c6.json /path/to/laravel/backend/storage/app/firebase-service-account.json
```

### 3. Add to .env
```env
FIREBASE_PROJECT_ID=chat-32491
FIREBASE_CREDENTIALS_PATH=storage/app/firebase-service-account.json
```

### 4. Create Config File
Create `config/firebase.php`:
```php
<?php
return [
    'project_id' => env('FIREBASE_PROJECT_ID', 'chat-32491'),
    'credentials_path' => env('FIREBASE_CREDENTIALS_PATH', 'storage/app/firebase-service-account.json'),
];
```

### 5. Update PushNotificationService
- Copy `FCM_V1_PUSHSERVICE_EXAMPLE.php` to `app/Services/PushNotificationService.php`
- Or update your existing service using the example

### 6. Test
```bash
# Test endpoint (add to routes/api.php)
POST /api/test-fcm-v1
Body: { "token": "ExponentPushToken[your-token]" }
```

### 7. Remove Legacy FCM
- ✅ Delete legacy server key from Firebase Console
- ✅ Remove `FCM_SERVER_KEY` from `.env`
- ✅ Remove legacy code

---

## 📝 Important Notes

1. **Expo Tokens**: Your app uses Expo push tokens, which are sent via Expo Push API (not directly via FCM)
2. **FCM v1**: The service account JSON is ready for when you migrate to native FCM tokens
3. **Both Work**: Current implementation uses Expo API for Expo tokens, FCM v1 ready for native tokens

---

## ✅ Verification

After setup, check logs:
```bash
tail -f storage/logs/laravel.log | grep -i firebase
```

You should see:
```
Firebase credentials loaded from default path
Firebase Messaging initialized successfully
```

---

**Status**: Ready to migrate!  
**See**: `FCM_V1_MIGRATION_GUIDE.md` for detailed instructions


