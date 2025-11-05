# 🧪 Testing Production Mode on Server

This guide shows you how to test your TechChat app in **production mode** on the server to verify it connects to the production API.

## ✅ What's Configured

- **Production API URL**: `https://healthclassique.tech-bridge.app/api`
- **Node.js Version**: v20.19.5 (updated from 20.19.0)
- **Production Scripts**: Added to `package.json`

---

## 🚀 Method 1: Test Production Web Build (Recommended)

This builds a production web bundle and serves it, simulating production exactly.

### Step 1: Build Production Web Bundle

```bash
cd /var/www/TechChat
npm run build:web:prod
```

This creates a `web-build` folder with optimized production files.

### Step 2: Serve the Production Build

**Option A: Using Python (Simple)**
```bash
cd web-build
python3 -m http.server 8080
```

**Option B: Using Node http-server**
```bash
npm install -g http-server
cd web-build
http-server -p 8080
```

### Step 3: Access and Test

1. Open browser: `http://your-server-ip:8080`
2. Open browser DevTools (F12)
3. Check Console logs - should show:
   - `isDev: false`
   - `apiBaseUrl: https://healthclassique.tech-bridge.app/api`
4. Test login, chat, and other features
5. Verify all API calls go to production URL

---

## 🚀 Method 2: Start Expo in Production Mode

Run Expo dev server in production mode (simulates production but with hot reload disabled).

### Option A: Web Production Mode

```bash
cd /var/www/TechChat
npm run start:prod:web
```

Then access: `http://localhost:19006` (or the URL shown in terminal)

### Option B: Tunnel Mode (for mobile testing)

```bash
cd /var/www/TechChat
npm run start:prod:tunnel
```

Then scan QR code with your development build app.

---

## 🔍 Method 3: Verify Production API Connection

### Test API Endpoint Directly

```bash
# Test if production API is accessible
curl -I https://healthclassique.tech-bridge.app/api

# Test specific endpoint (if you know the routes)
curl https://healthclassique.tech-bridge.app/api/auth/login -X POST -H "Content-Type: application/json" -d '{}' 2>&1 | head -20
```

### Check API Configuration in Code

The app uses `__DEV__` flag to determine production vs development:
- **Development**: `__DEV__ = true` → Uses local API URLs
- **Production**: `__DEV__ = false` → Uses `https://healthclassique.tech-bridge.app/api`

In production mode (`--no-dev` flag), `__DEV__` is automatically set to `false`.

---

## 📋 Quick Test Checklist

When testing production mode, verify:

- [ ] **API URL**: Console shows production API URL
- [ ] **Login**: Can login with production credentials
- [ ] **Chat**: Messages send/receive correctly
- [ ] **Network**: All API calls go to `healthclassique.tech-bridge.app`
- [ ] **No Dev Tools**: Production mode doesn't show dev tools
- [ ] **Performance**: App is optimized (minified code)
- [ ] **Errors**: Error handling works correctly

---

## 🎯 Quick Start Commands

### Test Production Web Build (Fastest)

```bash
cd /var/www/TechChat
npm run build:web:prod
cd web-build
python3 -m http.server 8080
# Then open http://your-server-ip:8080
```

### Test Production Mode with Tunnel

```bash
cd /var/www/TechChat
npm run start:prod:tunnel
# Scan QR code with development build app
```

---

## 🔧 How Production Mode Works

### Configuration Detection

The app checks `__DEV__` flag in `services/api.ts`:

```typescript
const getApiBaseUrl = () => {
  if (__DEV__) {
    // Development: Uses local URLs
    return AppConfig.api.development.physical;
  }
  // Production: Uses production URL
  return AppConfig.api.production;
};
```

### Production API URL

From `config/app.config.ts`:
```typescript
production: 'https://healthclassique.tech-bridge.app/api'
```

---

## 🐛 Troubleshooting

### Issue: Still using development API

**Solution**: 
- Ensure you're using `--no-dev` flag
- Check console logs show `isDev: false`
- Verify `NODE_ENV=production` is set

### Issue: API connection fails

**Solution**:
1. Test API directly: `curl https://healthclassique.tech-bridge.app/api`
2. Check CORS settings on backend
3. Verify SSL certificate is valid
4. Check firewall rules

### Issue: Can't access web build

**Solution**:
- Check port 8080 is not in use: `netstat -tulpn | grep 8080`
- Try different port: `python3 -m http.server 3000`
- Check firewall: `sudo ufw allow 8080`

---

## 📝 Available Production Scripts

Added to `package.json`:

```json
{
  "start:prod": "NODE_ENV=production expo start --no-dev --minify",
  "start:prod:web": "NODE_ENV=production expo start --no-dev --minify --web",
  "start:prod:tunnel": "NODE_ENV=production expo start --no-dev --minify --tunnel",
  "build:web:prod": "NODE_ENV=production npx expo export:web"
}
```

---

## ✅ Next Steps After Testing

Once production mode is verified:

1. **Build Production APK** (if testing mobile):
   ```bash
   eas build --profile production --platform android
   ```

2. **Deploy Web Build** (if deploying web):
   - Copy `web-build` folder to web server
   - Configure Nginx/Apache to serve it
   - Set up SSL certificate

3. **Test on Physical Device**:
   - Install production build
   - Test all features
   - Verify API connection

---

**Last Updated**: Production Testing Guide  
**Status**: Ready to Use


