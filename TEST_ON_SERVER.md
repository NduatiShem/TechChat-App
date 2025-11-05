# 🧪 Testing App on Server Before Building

Yes! You can test your Expo app on the server before building. Here are several methods:

---

## 🚀 Method 1: Expo Dev Server on Server (Recommended)

Run the Expo development server on your DigitalOcean server and connect from your device.

### Step 1: SSH into Your Server

```bash
ssh your-user@your-server-ip
```

### Step 2: Navigate to Project Directory

```bash
cd /path/to/TechChat-App
```

### Step 3: Install Dependencies (if not already done)

```bash
npm install
```

### Step 4: Start Expo Dev Server

**Option A: Local Network (if device is on same network)**
```bash
expo start
# or
npm start
```

**Option B: Tunnel Mode (works from anywhere)**
```bash
expo start --tunnel
# or
npm start -- --tunnel
```

**Option C: LAN Mode (faster, but requires same network)**
```bash
expo start --lan
```

### Step 5: Connect from Your Device

1. **Open your development build app** on your device
2. **Scan the QR code** shown in the terminal
3. **Or manually enter the URL** shown in the terminal

---

## 🌐 Method 2: Web Version (Quickest for Testing)

Test the web version of your app on the server - this is the fastest way to test UI and basic functionality.

### Step 1: Build Web Version

```bash
# On your server
cd /path/to/TechChat-App
npm install
npx expo export:web
```

### Step 2: Serve Web Build

**Option A: Using Python (if installed)**
```bash
cd web-build
python3 -m http.server 8080
# or
python -m SimpleHTTPServer 8080  # Python 2
```

**Option B: Using Node.js (if you have http-server)**
```bash
npm install -g http-server
cd web-build
http-server -p 8080
```

**Option C: Using Nginx (if already configured)**
```nginx
server {
    listen 8080;
    server_name your-server-ip;
    root /path/to/TechChat-App/web-build;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Step 3: Access in Browser

Open: `http://your-server-ip:8080` in your browser

---

## 📱 Method 3: Development Build with Dev Server

Since you already have a development build, you can connect it to the dev server on your server.

### On Server:

```bash
cd /path/to/TechChat-App
expo start --tunnel
```

### On Your Device:

1. Open the development build app
2. Scan the QR code or enter the tunnel URL
3. App will load from the server

**Benefits:**
- Test all native features
- Test on actual device
- Hot reload works
- No rebuild needed for code changes

---

## 🔧 Method 4: Using Expo Dev Tools (Web Interface)

Expo provides a web interface to manage your dev server.

### Step 1: Start Dev Server

```bash
expo start
```

### Step 2: Access Dev Tools

Open the URL shown in terminal (usually `http://localhost:19000`)

**If you need to access from outside:**
- Use tunnel mode: `expo start --tunnel`
- Or set up port forwarding in your SSH connection

---

## 🌍 Method 5: Expose Dev Server Publicly (Advanced)

If you want to access the dev server from anywhere without tunnel:

### Step 1: Start Dev Server with Host

```bash
expo start --host tunnel
# or specify your domain
expo start --host your-domain.com
```

### Step 2: Configure Firewall

```bash
# Allow port 19000 (Expo default)
sudo ufw allow 19000
# or
sudo iptables -A INPUT -p tcp --dport 19000 -j ACCEPT
```

### Step 3: Configure Nginx (Optional)

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:19000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 📋 Recommended Workflow

### For Quick Testing:
1. **Use Web Version** (Method 2) - fastest, good for UI testing
2. **Use Dev Server** (Method 1) - for testing native features

### For Full Testing Before Production:
1. **Run Dev Server on Server** with tunnel mode
2. **Connect Development Build** from your device
3. **Test all features** thoroughly
4. **Then build for production** when ready

---

## 🎯 Quick Start Commands

### On Your Server:

```bash
# Navigate to project
cd /path/to/TechChat-App

# Install dependencies (if needed)
npm install

# Start dev server with tunnel (works from anywhere)
expo start --tunnel

# Or start web version
npx expo export:web
cd web-build
python3 -m http.server 8080
```

### On Your Local Machine (Alternative):

You can also run the dev server locally and connect to your server's backend:

```bash
# On your local machine
cd C:\xampp\htdocs\TechChat-App
expo start

# Update config/app.config.ts to point to production API
# production: 'https://healthclassique.tech-bridge.app/api'
```

---

## ⚠️ Important Notes

### 1. **Development Build Required**
- You need a development build (which you already have)
- Regular Expo Go won't work with all features

### 2. **Tunnel Mode**
- Tunnel mode is slower but works from anywhere
- LAN mode is faster but requires same network
- Use tunnel for testing from different locations

### 3. **API Configuration**
- Make sure your API URL is correct in `config/app.config.ts`
- For server testing, use production API URL
- For local testing, use development API URL

### 4. **Port Forwarding (SSH)**
If running on server and connecting from outside:
```bash
# Forward local port to server
ssh -L 19000:localhost:19000 your-user@your-server-ip

# Then access via localhost:19000
```

---

## 🧪 Testing Checklist

Before building for production, test:

- [ ] App launches without crashes
- [ ] Login/Register works
- [ ] Messages send/receive correctly
- [ ] File uploads work
- [ ] Voice messages work
- [ ] Push notifications work
- [ ] Navigation works smoothly
- [ ] Splash screen displays correctly
- [ ] Logo is centered and not cut off
- [ ] All screens load properly
- [ ] API calls work correctly
- [ ] Error handling works

---

## 🚀 Quick Test Command

**Fastest way to test on server:**

```bash
# On your server
cd /path/to/TechChat-App
expo start --tunnel

# Then scan QR code with your development build app
```

---

## 📝 Environment-Specific Testing

### Test on Server (Production API):
```bash
# Ensure config/app.config.ts has:
production: 'https://healthclassique.tech-bridge.app/api'
```

### Test Locally (Development API):
```bash
# Ensure config/app.config.ts has:
development: {
  physical: 'http://your-local-ip:8000/api'
}
```

---

## 🆘 Troubleshooting

### Issue: Can't connect to dev server
**Solution:**
- Use `--tunnel` flag
- Check firewall settings
- Verify network connectivity

### Issue: Dev server not starting
**Solution:**
- Check Node.js version: `node --version` (should be 14+)
- Check if port 19000 is available
- Try different port: `expo start --port 8080`

### Issue: App not loading on device
**Solution:**
- Ensure development build is installed
- Check device and server are connected
- Verify API URL is correct

---

**Last Updated**: Testing on Server Guide v1.0  
**Status**: Ready to Use

