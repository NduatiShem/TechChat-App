# Fixing Development Build Errors

## Error 1: Firebase/FCM Not Initialized

**Error Message:**
```
Error getting Expo push token: Error: Default FirebaseApp is not initialized
```

**What This Means:**
- Push notifications require Firebase Cloud Messaging (FCM) credentials
- Your development build doesn't have FCM configured yet

**Solutions:**

### Option A: Skip Push Notifications (Quick Fix for Testing)
The app will still work without push notifications. The error is now handled gracefully and won't crash the app.

### Option B: Set Up FCM Credentials (For Full Functionality)

1. **Follow Expo's FCM Setup Guide:**
   https://docs.expo.dev/push-notifications/fcm-credentials/

2. **Steps:**
   - Create a Firebase project (if you don't have one)
   - Download `google-services.json` from Firebase Console
   - Upload to Expo using EAS:
     ```bash
     eas credentials
     # Select Android > Push Notifications
     # Upload google-services.json
     ```

3. **Rebuild the App:**
   ```bash
   eas build --profile development --platform android
   ```

**For Now:**
- The app works fine without push notifications
- You can test all other features
- Set up FCM when you're ready for production

---

## Error 2: 401 Unauthenticated

**Error Message:**
```
Request failed with status code 401
Unauthenticated.
```

**What This Means:**
- The app is trying to load conversations but you're not logged in
- Fresh development builds don't have stored auth tokens

**Solution:**

1. **Log In:**
   - Open the app on your device
   - You should see the login screen
   - Enter your email and password
   - Log in normally

2. **If Login Screen Doesn't Show:**
   - The app should automatically redirect to login on 401 errors
   - If it doesn't, try closing and reopening the app
   - Make sure the backend server is running

3. **Check Backend Connection:**
   - Verify your Laravel backend is running
   - Check the API URL in `config/app.config.ts`
   - Ensure device and computer are on same network

---

## Quick Fix Checklist

- [ ] App opens successfully
- [ ] Login screen appears
- [ ] Can log in with your credentials
- [ ] After login, conversations load
- [ ] Push notification error is logged but doesn't crash app

---

## Testing Without Push Notifications

The app is fully functional without push notifications. You can:
- ✅ Log in and authenticate
- ✅ Send/receive messages
- ✅ Upload files and images
- ✅ Use voice messages
- ✅ Test all chat features
- ⚠️ Push notifications won't work until FCM is configured

---

## Next Steps

1. **For Development/Testing:**
   - Ignore the Firebase error for now
   - Log in to test the app
   - All features work except push notifications

2. **For Production:**
   - Set up FCM credentials
   - Rebuild with credentials
   - Push notifications will work

---

## Common Issues

**"Can't connect to backend"**
- Check backend is running
- Verify IP address in `config/app.config.ts`
- Ensure same Wi-Fi network

**"Login doesn't work"**
- Check backend API is accessible
- Verify credentials are correct
- Check console logs for errors

**"Still seeing errors"**
- Clear app data and restart
- Rebuild development build
- Check all network connections


