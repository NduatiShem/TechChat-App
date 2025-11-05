# TechChat App - Development Build Guide

This guide will help you build a development version of the TechChat app for testing on your device.

## Prerequisites

1. **EAS CLI Installed**:
   ```bash
   npm install -g eas-cli
   ```

2. **Logged into Expo Account**:
   ```bash
   eas login
   ```
   (If you don't have an account, sign up at https://expo.dev)

3. **EAS Build Service Configured**:
   - Your project already has `eas.json` configured
   - You have a project ID: `da2b4840-030b-49e4-b16d-21748aec572c`

## Building for Android (APK)

### Option 1: Development Build (Recommended for Testing)
This creates an APK that includes the Expo development client, allowing you to load the app with `expo start`.

```bash
# Build development APK for Android
eas build --profile development --platform android
```

**After Build:**
1. Download the APK from the EAS build page (link will be provided after build)
2. Install on your Android device:
   ```bash
   # Enable "Install from Unknown Sources" on your device
   # Transfer APK to device and install
   ```
3. Start the development server:
   ```bash
   npm start
   # or
   expo start
   ```
4. Scan the QR code with your development build app (not Expo Go)

### Option 2: Preview Build (APK - Quick Testing)
This creates a standalone APK you can test immediately:

```bash
# Build preview APK for Android
eas build --profile preview --platform android
```

**After Build:**
- Download and install the APK directly
- No need to run `expo start` - this is a standalone build
- Good for sharing with testers

## Building for iOS

### Development Build
```bash
# Build development IPA for iOS
eas build --profile development --platform ios
```

**After Build:**
1. Download from EAS build page
2. Install via TestFlight (recommended) or direct install
3. Run `expo start` and connect to the development build

### Preview Build
```bash
# Build preview IPA for iOS
eas build --profile preview --platform ios
```

## Quick Build Commands

```bash
# Android Development Build
eas build --profile development --platform android

# Android Preview Build (Standalone APK)
eas build --profile preview --platform android

# iOS Development Build
eas build --profile development --platform ios

# Both platforms
eas build --profile development --platform all
```

## After Building

### Development Build Workflow:
1. **Install the development build** on your device
2. **Run the dev server**:
   ```bash
   npm start
   # or
   expo start
   ```
3. **Open the development build app** on your device
4. **Scan the QR code** or enter the URL manually
5. The app will load and you can test all features

### Preview Build Workflow:
1. **Download and install** the APK/IPA
2. **Open the app** directly - no dev server needed
3. Test all features

## Troubleshooting

### Build Fails
- Check your internet connection
- Ensure you're logged in: `eas login`
- Check build logs on expo.dev dashboard

### App Won't Connect to Dev Server
- Ensure your device and computer are on the same Wi-Fi network
- Check your API configuration in `config/app.config.ts`
- Verify the server IP address matches your network

### API Connection Issues
- Update `config/app.config.ts` with your server's IP address:
  ```typescript
  physical: 'http://YOUR_COMPUTER_IP:8000/api'
  ```
- Ensure your Laravel backend is running
- Check firewall settings

## Build Profiles (from eas.json)

- **development**: Includes Expo dev client, requires `expo start` to run
- **preview**: Standalone build for testing, no dev server needed
- **production**: Production-ready build for app stores

## Next Steps

1. Build the development APK/IPA using the commands above
2. Install on your test device
3. Test all features:
   - Authentication
   - Chat (individual and group)
   - File/Image uploads
   - Voice messages
   - Notifications
   - Profile updates
4. Report any issues found during testing

## Build Status

Check build status and download links at:
- https://expo.dev/accounts/shemnduati/projects/techchat/builds

---

**Note**: Development builds use your current codebase. If you make changes after building, you'll need to rebuild OR use the development build with `expo start` (which updates automatically).


