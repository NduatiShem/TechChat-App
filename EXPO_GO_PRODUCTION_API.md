# 🔧 Expo Go with Production API - Solution

## ❌ The Problem

When you run `npm run start:prod:tunnel` with `--no-dev` flag:
- Expo Go **cannot open** the app
- QR code doesn't work
- This is because Expo Go only supports **development mode**

## ✅ The Solution

I've added a new script that:
- ✅ Works with **Expo Go** (development mode)
- ✅ Uses **production API** (`https://healthclassique.tech-bridge.app/api`)
- ✅ Works with **tunnel** connection

### New Script:
```bash
npm run start:prod-api:tunnel
```

This script:
- Uses `EXPO_PUBLIC_FORCE_PRODUCTION=true` to force production API
- Runs in development mode (works with Expo Go)
- Uses tunnel for remote access

---

## 📋 Available Scripts

### For Expo Go Testing (with Production API):
```bash
npm run start:prod-api:tunnel
```
- ✅ Works with Expo Go
- ✅ Uses production API
- ✅ Tunnel connection

### For Regular Development:
```bash
npm run start:tunnel
# or
npm start -- --tunnel
```
- ✅ Works with Expo Go
- ✅ Uses development API (local)
- ✅ Tunnel connection

### For Production Builds (NOT for Expo Go):
```bash
npm run start:prod:tunnel
```
- ❌ Does NOT work with Expo Go
- ✅ Requires development build
- ✅ Full production mode

---

## 🚀 Quick Start

1. **Stop current process** (if running):
   ```bash
   pkill -f "expo start"
   ```

2. **Start with production API** (works with Expo Go):
   ```bash
   npm run start:prod-api:tunnel
   ```

3. **Scan QR code** with Expo Go app

4. **App will connect to**: `https://healthclassique.tech-bridge.app/api`

---

## 🔍 How It Works

The `services/api.ts` file checks for `EXPO_PUBLIC_FORCE_PRODUCTION`:
- If `true` → Uses production API even in Expo Go
- If `false` → Uses development API (local)

The new script sets this environment variable to force production API while still allowing Expo Go to work.

---

## ⚠️ Important Notes

### Expo Go Limitations:
- Expo Go **always** runs in development mode (`__DEV__ = true`)
- Cannot use `--no-dev` flag with Expo Go
- Cannot test true production builds with Expo Go

### For True Production Testing:
- Build a development build: `eas build --profile development --platform android`
- Then you can use `npm run start:prod:tunnel` with the development build

---

## 🎯 Summary

**Use this for testing with Expo Go:**
```bash
npm run start:prod-api:tunnel
```

**This will:**
- ✅ Work with Expo Go
- ✅ Connect to production API
- ✅ Allow you to test production API endpoints
- ✅ Work with tunnel for remote access

**The QR code will work!** 🎉

