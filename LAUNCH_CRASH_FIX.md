# 🚨 Launch Crash Fix Guide

## Quick Diagnostic Steps

### Step 1: Get Crash Logs

**Android (using ADB):**
```bash
# Connect your device via USB
# Enable USB debugging on your device

# Get crash logs
adb logcat | grep -i "ReactNativeJS\|FATAL\|AndroidRuntime\|crash"

# Or get all logs and save to file
adb logcat > crash_logs.txt

# Filter for React Native errors
adb logcat | grep -E "ReactNativeJS|Error|Exception|FATAL" > crash_logs.txt
```

**Android (Direct on Device):**
1. Open the app
2. When it crashes, immediately:
   - Go to Settings → Apps → TechChat
   - Tap "App Info" or "Details"
   - Look for "Crash logs" or check logcat via Developer Options

**iOS (if using):**
```bash
# Connect device via USB
xcrun simctl spawn booted log stream --level=error
```

---

### Step 2: Check Common Launch Crash Causes

#### 1. **API Connection Issues**
**Symptom:** App crashes immediately on launch, before showing any screen

**Check:**
- Is your backend API accessible?
- Is the API URL correct in production build?
- Can the device reach the API (network connectivity)?

**Test:**
```bash
# Test API from device network
curl https://healthclassique.tech-bridge.app/api/auth/login
```

**Fix:** Ensure API URL is correct and backend is accessible

---

#### 2. **SecureStorage Initialization Error**
**Symptom:** Crash happens during AuthContext initialization

**Check logs for:**
```
Error: SecureStorage not initialized
Error: Cannot read property 'getItem' of undefined
```

**Fix:** This is usually handled, but if it persists, we may need to add initialization checks.

---

#### 3. **NotificationContext Firebase/FCM Error**
**Symptom:** Crash happens when trying to get push token

**Check logs for:**
```
Error: Default FirebaseApp is not initialized
Error: FCM not configured
```

**Fix:** This should be handled gracefully, but may need additional error handling.

---

#### 4. **Native Module Error**
**Symptom:** Crash with native module errors

**Check logs for:**
```
Error: Native module not found
Error: Cannot find module 'expo-xxx'
```

**Fix:** Ensure all native dependencies are properly installed and built.

---

#### 5. **Memory/Resource Error**
**Symptom:** App crashes immediately without error logs

**Check logs for:**
```
OutOfMemoryError
FATAL EXCEPTION
```

**Fix:** May need to optimize image loading or reduce initial bundle size.

---

## Step 3: Quick Fixes to Try

### Fix 1: Add Delayed Initialization

Add a small delay before API calls to ensure everything is initialized:

```typescript
// In AuthContext.tsx - add delay in checkAuth
const checkAuth = async () => {
  // Add small delay to ensure secureStorage is ready
  await new Promise(resolve => setTimeout(resolve, 100));
  
  try {
    // ... rest of the code
  }
}
```

### Fix 2: Add More Error Handling

Wrap all initialization in try-catch blocks.

### Fix 3: Disable Problematic Features Temporarily

If notification initialization is causing crashes, temporarily disable it:

```typescript
// In NotificationContext.tsx
useEffect(() => {
  // Temporarily disable to test
  // getExpoPushToken().catch(...);
}, []);
```

---

## Step 4: Get Detailed Error Information

### Enable More Logging

Add this to your app entry point to catch all errors:

```typescript
// In app/_layout.tsx or entry file
import { LogBox } from 'react-native';

// Enable all logs
LogBox.ignoreAllLogs(false);

// Catch unhandled promise rejections
if (typeof global.Promise !== 'undefined') {
  const originalPromise = global.Promise;
  global.Promise = class extends originalPromise {
    constructor(...args: any[]) {
      super(...args);
      this.catch((error: any) => {
        console.error('Unhandled Promise Rejection:', error);
        return this;
      });
    }
  };
}
```

---

## Step 5: Test with Minimal Configuration

Create a test build with minimal features to isolate the issue:

1. **Temporarily disable notifications:**
   - Comment out NotificationProvider initialization
   
2. **Temporarily disable API calls:**
   - Mock the API responses
   
3. **Test step by step:**
   - Add features back one by one
   - Identify which feature causes the crash

---

## Step 6: Share Crash Logs

Once you have the crash logs, look for:

1. **Error message** - The actual error text
2. **Stack trace** - Where the error occurred
3. **Timing** - When during launch it crashes (immediately, after splash, etc.)

**Common patterns to look for:**
- `TypeError: Cannot read property 'X' of undefined`
- `Error: Network request failed`
- `Error: SecureStorage not initialized`
- `FATAL EXCEPTION: main`

---

## Quick Checklist

Before rebuilding, verify:

- [ ] Backend API is accessible: https://healthclassique.tech-bridge.app
- [ ] Device has internet connection
- [ ] All dependencies installed: `npm install`
- [ ] No missing native modules
- [ ] SecureStorage is properly configured
- [ ] Notification permissions are optional (not required)

---

## Next Steps

1. **Get the crash logs** using Step 1 above
2. **Identify the error** from the logs
3. **Try the quick fixes** from Step 3
4. **Share the error message** with me for specific fixes
5. **Rebuild and test** after fixes

---

## Need Help?

Share the crash logs or error message, and I'll help you fix it!

**Common crash log locations:**
- Android: `adb logcat` output
- Device: Settings → Apps → TechChat → Crash logs
- Console: React Native debugger console

