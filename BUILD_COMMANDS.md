# Quick Build Commands

## Prerequisites Check
```bash
# Check if EAS CLI is installed
eas --version

# If not installed:
npm install -g eas-cli

# Login to Expo
eas login
```

## Android Development Build (Recommended for Testing)

### Step 1: Build the APK
```bash
eas build --profile development --platform android
```

This will:
- Create a development build with Expo dev client
- Generate an APK you can install on Android devices
- Allow you to connect to `expo start` for live updates

### Step 2: Wait for Build
- Build takes 10-20 minutes
- You'll get a link to download when ready
- Check status: https://expo.dev/accounts/shemnduati/projects/techchat/builds

### Step 3: Download & Install
```bash
# Download the APK from the build page
# Transfer to your Android device
# Enable "Install from Unknown Sources" in Android settings
# Install the APK
```

### Step 4: Run Development Server
```bash
# In your project directory
npm start
# or
expo start
```

### Step 5: Connect Device
1. Open the development build app on your device
2. Scan the QR code or enter the URL manually
3. Your app will load!

---

## Android Preview Build (Standalone - No Dev Server Needed)

```bash
eas build --profile preview --platform android
```

This creates a standalone APK you can install and test immediately without running `expo start`.

---

## iOS Development Build

```bash
eas build --profile development --platform ios
```

**Note**: iOS builds require an Apple Developer account. The build will be available via TestFlight or direct download.

---

## All Commands Summary

```bash
# Android Development (with dev client)
eas build --profile development --platform android

# Android Preview (standalone)
eas build --profile preview --platform android

# iOS Development
eas build --profile development --platform ios

# Both platforms
eas build --profile development --platform all
```

---

## After Installation

### For Development Build:
1. Install the APK/IPA on your device
2. Run `npm start` or `expo start`
3. Open the app and connect to the dev server

### For Preview Build:
1. Install the APK/IPA
2. Open the app directly - no dev server needed
3. Test all features

---

## Need Help?

- Check build logs: https://expo.dev/accounts/shemnduati/projects/techchat/builds
- EAS Build docs: https://docs.expo.dev/build/introduction/
- Troubleshooting: See BUILD_GUIDE.md


