# 🚀 Start Your Development Build

You're all set! Run this command to build your Android development APK:

```bash
eas build --profile development --platform android
```

## What Will Happen

1. **Build Process** (10-20 minutes):
   - EAS will compile your app
   - Create an APK with Expo dev client included
   - Upload to Expo servers

2. **You'll Get**:
   - A download link when the build completes
   - Link to monitor build progress
   - Instructions for installation

3. **After Download**:
   - Transfer APK to your Android device
   - Enable "Install from Unknown Sources"
   - Install the APK
   - Run `npm start` or `expo start` on your computer
   - Open the development build app
   - Scan QR code to load your app

## Quick Start Command

```bash
eas build --profile development --platform android
```

---

## Alternative: Preview Build (Standalone - No Dev Server)

If you want a standalone APK that doesn't need `expo start`:

```bash
eas build --profile preview --platform android
```

This creates a regular APK you can install and test immediately without running the dev server.

---

## Monitor Build Progress

After starting the build, you'll get a link like:
```
https://expo.dev/accounts/shemnduati/projects/techchat/builds/[build-id]
```

Check the status there or run:
```bash
eas build:list
```

---

## After Installation

### For Development Build:
1. Install APK on device
2. Run `npm start` in your project
3. Open the dev build app on device
4. Scan QR code or enter URL
5. App loads with live updates!

### For Preview Build:
1. Install APK on device
2. Open and test - no dev server needed

---

## Troubleshooting

**Build fails?**
- Check internet connection
- Verify you're logged in: `eas whoami`
- Check build logs on expo.dev

**App won't connect?**
- Ensure device and computer are on same Wi-Fi
- Check API config in `config/app.config.ts`
- Verify server IP address

---

Ready? Run the build command above! 🎉


