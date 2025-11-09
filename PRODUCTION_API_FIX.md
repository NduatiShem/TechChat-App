# 🔧 Production API URL Fix

## Problem
The app is trying to connect to local development IP (`http://192.168.100.25:8000/api`) instead of production URL (`https://healthclassique.tech-bridge.app/api`).

## Solution Applied

### 1. Updated API Detection Logic
- Added environment variable check: `EXPO_PUBLIC_FORCE_PRODUCTION`
- Production builds will now use production URL even if `__DEV__` is true
- Added explicit environment variable support for API URL

### 2. Updated EAS Build Configuration
- Added `EXPO_PUBLIC_FORCE_PRODUCTION=true` to production build profile
- This ensures production builds always use production API

### 3. Enhanced Logging
- API URL is now always logged for debugging
- Shows which mode (dev/production) is being used

## For Current Issue (Expo Go / Development Build)

If you're testing in **Expo Go** or a **development build**, the app will use development URLs. To test with production API:

### Option 1: Create a `.env` file (Quick Fix)
Create a `.env` file in the project root:
```
EXPO_PUBLIC_FORCE_PRODUCTION=true
```

Then restart Expo:
```bash
npx expo start --clear
```

### Option 2: Build Production APK
Build a production APK which will automatically use production API:
```bash
eas build --profile production --platform android
```

### Option 3: Use Production Build Locally
```bash
NODE_ENV=production EXPO_PUBLIC_FORCE_PRODUCTION=true npx expo start --no-dev
```

## Verification

After applying the fix, check the console logs. You should see:
```
[API] Production mode - Using production URL: https://healthclassique.tech-bridge.app/api
[API] Base URL configured: https://healthclassique.tech-bridge.app/api
```

Instead of:
```
[API] Development mode - Using Android URL: http://192.168.100.25:8000/api
```

## Next Steps

1. **If using Expo Go**: Create `.env` file with `EXPO_PUBLIC_FORCE_PRODUCTION=true`
2. **If building APK**: Use `eas build --profile production` (already configured)
3. **Test**: Verify the app connects to production API

