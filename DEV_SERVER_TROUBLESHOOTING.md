# Development Server Troubleshooting

## Error: UnableToResolveError

This error occurs when the development build can't connect to the Metro bundler.

## Common Causes & Solutions

### 1. **Dev Server Not Running**
The development build needs the Metro bundler to be running.

**Solution:**
```bash
npm start
# or
expo start
```

### 2. **Wrong IP Address**
The app is trying to connect to `192.168.106.65` but your computer's IP is `192.168.100.65`.

**Solutions:**

**Option A: Use Tunnel Mode (Recommended)**
```bash
expo start --tunnel
```
This creates a secure tunnel that works from any network.

**Option B: Use LAN Mode with Correct IP**
```bash
expo start --lan
```
Then ensure your device and computer are on the same Wi-Fi network.

**Option C: Manual Connection**
1. Run `expo start`
2. Press `s` to switch connection mode
3. Select "LAN" or "Tunnel"
4. Scan the QR code or enter the URL manually in the dev build app

### 3. **Firewall Blocking Connection**
Windows Firewall might be blocking the Metro bundler port.

**Solution:**
1. Open Windows Defender Firewall
2. Allow Node.js through firewall
3. Or allow port 8081 (default Metro port) through firewall

### 4. **Network Issues**
Device and computer must be on the same Wi-Fi network.

**Check:**
- Device Wi-Fi network name
- Computer Wi-Fi network name
- They should match!

### 5. **Clear Cache and Restart**
```bash
# Clear Metro bundler cache
expo start --clear

# Or
npm start -- --clear
```

## Quick Fix Steps

1. **Start the dev server:**
   ```bash
   npm start
   ```

2. **Press `s` in the terminal** to switch to tunnel mode:
   ```
   › Press s │ switch to tunnel
   ```

3. **Wait for tunnel URL** (takes a few seconds)

4. **In your development build app:**
   - Scan the QR code, OR
   - Manually enter the URL shown in terminal

## Connection Modes

- **LAN**: Fast, but requires same Wi-Fi network
- **Tunnel**: Works from any network, slower but more reliable
- **Localhost**: Only works on emulator/simulator

## Still Not Working?

1. Check that `expo start` is running
2. Verify the URL in terminal matches what the app is trying to connect to
3. Try tunnel mode: `expo start --tunnel`
4. Restart both dev server and the app
5. Clear cache: `expo start --clear`


