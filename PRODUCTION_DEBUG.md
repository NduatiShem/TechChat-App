# 🔍 Production Debugging Guide

## Common Production Issues

### Issue 1: API Connection Fails in Production

**Symptoms:**
- App works in development but fails in production
- Network errors or connection timeouts
- API calls fail with "Network Error"

**Debugging Steps:**

1. **Check API URL is correct:**
   ```javascript
   // In production, check console logs for:
   [API] Production mode - Using production URL: https://healthclassique.tech-bridge.app/api
   ```

2. **Verify Production API is accessible:**
   ```bash
   # Test from command line
   curl https://healthclassique.tech-bridge.app/api
   
   # Test specific endpoint
   curl https://healthclassique.tech-bridge.app/api/auth/login
   ```

3. **Check CORS Configuration:**
   - Production API must allow requests from your app
   - Check backend CORS settings
   - Verify `Access-Control-Allow-Origin` headers

4. **Check SSL Certificate:**
   - Verify SSL certificate is valid
   - Check certificate expiration
   - Ensure certificate chain is complete

### Issue 2: App Uses Development API in Production

**Symptoms:**
- App connects to local IP (192.168.x.x) instead of production URL
- Console shows development API URL

**Solution:**
- Ensure you're building with production profile:
  ```bash
  eas build --profile production --platform android
  ```
- In Expo Go, ensure you're not in development mode
- Check `__DEV__` flag is `false` in production builds

### Issue 3: Android Network Security Errors

**Symptoms:**
- "Cleartext traffic not permitted" errors
- Network requests blocked

**Solution:**
- Already configured in `app.json`:
  ```json
  "usesCleartextTraffic": false,
  "networkSecurityConfig": {
    "cleartextTrafficPermitted": false
  }
  ```
- Production API uses HTTPS, so this should work

### Issue 4: Authentication Issues

**Symptoms:**
- Login fails in production
- Token not saved/retrieved correctly

**Debugging:**
1. Check if token is being saved:
   ```javascript
   // Add temporary logging in AuthContext
   console.log('Token saved:', token);
   ```

2. Verify token format matches backend expectations

3. Check token expiration handling

## 🔧 Debugging Tools

### Enable API Debugging

Add to your `.env` file (or set in EAS):
```
EXPO_PUBLIC_DEBUG_API=true
```

This will log:
- API base URL being used
- `__DEV__` flag value
- Platform information
- All API requests/responses

### Check Current Configuration

The app logs API configuration on startup:
```
[API] Production mode - Using production URL: https://healthclassique.tech-bridge.app/api
[API] Base URL configured: https://healthclassique.tech-bridge.app/api
[API] __DEV__ flag: false
[API] Platform: android
```

### Test API Connection

Use the NetworkTest component in your app to verify connectivity.

## 📱 Testing Production Build

### Before Building:
1. ✅ Verify production API URL in `config/app.config.ts`
2. ✅ Test API endpoint accessibility
3. ✅ Check CORS configuration
4. ✅ Verify SSL certificate

### After Building:
1. Install production build on device
2. Check console logs for API URL
3. Test login functionality
4. Test message sending/receiving
4. Verify all API endpoints work

## 🐛 Common Error Messages

### "Network Error"
- **Cause:** Cannot reach API server
- **Fix:** Check internet connection, verify API URL, check firewall

### "CORS Error"
- **Cause:** Backend not allowing requests from app
- **Fix:** Configure CORS on backend to allow your app origin

### "SSL Certificate Error"
- **Cause:** Invalid or expired SSL certificate
- **Fix:** Renew SSL certificate on server

### "401 Unauthorized"
- **Cause:** Invalid or expired token
- **Fix:** User needs to login again

### "Timeout Error"
- **Cause:** API server not responding
- **Fix:** Check server status, increase timeout if needed

## 📞 Next Steps

If issues persist:
1. Check server logs for API requests
2. Verify backend is running and accessible
3. Test API endpoints directly with curl/Postman
4. Check network connectivity on device
5. Review error logs in production build



