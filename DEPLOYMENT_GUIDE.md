# 🚀 TechChat App - Production Deployment Guide

## Overview

This guide will help you deploy your TechChat app to production. Your backend API is already hosted at:
**https://healthclassique.tech-bridge.app**

---

## ✅ Step 1: Configuration Update (COMPLETED)

The production API URL has been updated in `config/app.config.ts`:
```typescript
production: 'https://healthclassique.tech-bridge.app/api'
```

All API calls will now use this URL when the app is built in production mode.

---

## 📋 Step 2: Pre-Deployment Checklist

Before building, verify:

- [x] Production API URL is configured
- [ ] Backend API is accessible at https://healthclassique.tech-bridge.app
- [ ] Backend CORS is configured to allow your frontend domain
- [ ] SSL certificate is valid (HTTPS)
- [ ] Database is configured and accessible
- [ ] Environment variables are set on the server

---

## 🔨 Step 3: Build Options

You have three deployment options:

### Option A: Mobile Apps (Android/iOS) - Recommended
Build native mobile apps for Android and iOS devices.

### Option B: Web App
Deploy as a Progressive Web App (PWA) accessible via browser.

### Option C: Hybrid
Deploy both mobile apps and web version.

---

## 📱 Option A: Building Mobile Apps for Production

### Prerequisites

1. **Install EAS CLI** (if not already installed):
```bash
npm install -g eas-cli
```

2. **Login to Expo**:
```bash
eas login
```

### Build Android Production APK/AAB

```bash
# Build APK (for direct installation)
eas build --profile production --platform android

# OR Build AAB (for Google Play Store)
eas build --profile production --platform android --build-type app-bundle
```

**What happens:**
- Build takes 15-30 minutes
- You'll get a download link when ready
- Check status: https://expo.dev/accounts/shemnduati/projects/techchat/builds

### Build iOS Production App

```bash
eas build --profile production --platform ios
```

**Requirements:**
- Apple Developer account ($99/year)
- The build will be available via TestFlight or direct download

### After Build Completion

1. **Download the build** from Expo dashboard
2. **Test on physical devices**:
   - Install APK on Android device
   - Install IPA on iOS device (via TestFlight or direct install)
3. **Verify**:
   - App connects to production API
   - Login/Register works
   - Messages send/receive correctly
   - Push notifications work
   - File uploads work

---

## 🌐 Option B: Deploying Web Version

### Step 1: Build Web Bundle

```bash
# Install dependencies (if not already done)
npm install

# Build web version
npx expo export:web
```

This creates a `web-build` folder with static files.

### Step 2: Deploy to DigitalOcean Server

Since your frontend is already cloned on the DigitalOcean server, follow these steps:

#### On Your DigitalOcean Server:

1. **SSH into your server**:
```bash
ssh your-user@your-server-ip
```

2. **Navigate to your frontend directory**:
```bash
cd /path/to/TechChat-App
```

3. **Pull latest changes** (if using Git):
```bash
git pull origin main
```

4. **Install dependencies**:
```bash
npm install
```

5. **Build the web version**:
```bash
npx expo export:web
```

6. **Configure web server** (Nginx example):

Create or update Nginx configuration:
```nginx
server {
    listen 80;
    server_name healthclassique.tech-bridge.app;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name healthclassique.tech-bridge.app;
    
    ssl_certificate /path/to/ssl/certificate.crt;
    ssl_certificate_key /path/to/ssl/private.key;
    
    root /path/to/TechChat-App/web-build;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # API proxy (if needed)
    location /api {
        proxy_pass https://healthclassique.tech-bridge.app/api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

7. **Restart Nginx**:
```bash
sudo nginx -t  # Test configuration
sudo systemctl restart nginx
```

### Alternative: Using Apache

If you're using Apache instead of Nginx:

```apache
<VirtualHost *:443>
    ServerName healthclassique.tech-bridge.app
    DocumentRoot /path/to/TechChat-App/web-build
    
    SSLEngine on
    SSLCertificateFile /path/to/ssl/certificate.crt
    SSLCertificateKeyFile /path/to/ssl/private.key
    
    <Directory /path/to/TechChat-App/web-build>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    
    # Rewrite rules for React Router
    RewriteEngine On
    RewriteBase /
    RewriteRule ^index\.html$ - [L]
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule . /index.html [L]
</VirtualHost>
```

---

## 🎯 Option C: Hybrid Deployment (Recommended)

Deploy both mobile apps and web version for maximum reach:

1. **Build mobile apps** (Option A)
2. **Deploy web version** (Option B)
3. **Share links**:
   - Mobile: Direct download links or app store listings
   - Web: https://healthclassique.tech-bridge.app (or subdomain)

---

## 🔧 Step 4: Backend Configuration

### Verify Backend is Ready

1. **Test API endpoints**:
```bash
curl https://healthclassique.tech-bridge.app/api/auth/login
```

2. **Check CORS configuration**:
   - Ensure your frontend domain is allowed in CORS settings
   - For mobile apps: Allow all origins or specific patterns
   - For web: Add your frontend domain explicitly

3. **Verify SSL Certificate**:
```bash
curl -I https://healthclassique.tech-bridge.app
```

4. **Test database connection**:
   - Ensure database is accessible
   - Test creating a user account

---

## 🧪 Step 5: Testing Production Build

### Mobile App Testing

1. **Install production build** on test device
2. **Test all features**:
   - [ ] User registration
   - [ ] User login
   - [ ] Send/receive messages
   - [ ] Group chat
   - [ ] File uploads (images, documents)
   - [ ] Voice messages
   - [ ] Push notifications
   - [ ] Profile updates
   - [ ] Avatar uploads
   - [ ] Offline behavior

3. **Test on different devices**:
   - Android (various versions)
   - iOS (if applicable)
   - Different screen sizes

### Web App Testing

1. **Open in browser**: https://healthclassique.tech-bridge.app
2. **Test in different browsers**:
   - Chrome
   - Firefox
   - Safari
   - Edge
3. **Test responsive design**:
   - Desktop
   - Tablet
   - Mobile viewport

---

## 📊 Step 6: Monitoring & Maintenance

### Set Up Monitoring

1. **Error tracking** (optional but recommended):
   - Consider Sentry or similar service
   - Monitor API errors
   - Track app crashes

2. **Analytics** (optional):
   - Track user engagement
   - Monitor API usage
   - Monitor app performance

### Regular Maintenance

1. **Update dependencies** periodically:
```bash
npm update
```

2. **Monitor server resources**:
   - CPU usage
   - Memory usage
   - Disk space
   - Database size

3. **Backup database** regularly

4. **Monitor API logs** for errors

---

## 🚨 Step 7: Troubleshooting

### Common Issues

#### Issue: App can't connect to API
**Solution:**
- Check if API URL is correct in production build
- Verify CORS settings on backend
- Check SSL certificate validity
- Test API endpoint directly with curl

#### Issue: Push notifications not working
**Solution:**
- Verify FCM/APNS configuration
- Check device token registration
- Verify backend notification service
- Check device permissions

#### Issue: File uploads failing
**Solution:**
- Check file size limits on backend
- Verify upload directory permissions
- Check disk space on server
- Verify CORS headers for file uploads

#### Issue: Web app shows blank page
**Solution:**
- Check browser console for errors
- Verify web-build files are deployed correctly
- Check Nginx/Apache configuration
- Verify base URL in app configuration

---

## 📝 Step 8: Going Live Checklist

Before announcing your app is live:

- [ ] Production API URL is configured
- [ ] Mobile apps built and tested
- [ ] Web version deployed and tested (if applicable)
- [ ] SSL certificate is valid
- [ ] CORS is configured correctly
- [ ] Database is backed up
- [ ] All features tested and working
- [ ] Push notifications working
- [ ] File uploads working
- [ ] Error handling tested
- [ ] Performance is acceptable
- [ ] Monitoring is set up (optional)

---

## 🎉 Step 9: Launch!

Once everything is tested and working:

1. **Share mobile app links**:
   - Direct APK download link (Android)
   - TestFlight link (iOS)
   - Or submit to app stores

2. **Share web app URL**:
   - https://healthclassique.tech-bridge.app (or your frontend domain)

3. **Monitor closely** in the first few days:
   - Check for errors
   - Monitor server resources
   - Gather user feedback

---

## 📚 Additional Resources

- **Expo EAS Build**: https://docs.expo.dev/build/introduction/
- **Expo Web Deployment**: https://docs.expo.dev/workflow/web/
- **DigitalOcean App Platform**: https://www.digitalocean.com/products/app-platform
- **Nginx Configuration**: https://nginx.org/en/docs/
- **Apache Configuration**: https://httpd.apache.org/docs/

---

## 🆘 Need Help?

If you encounter issues:

1. Check the troubleshooting section above
2. Review server logs
3. Check Expo build logs: https://expo.dev/accounts/shemnduati/projects/techchat/builds
4. Test API endpoints directly
5. Verify configuration files

---

**Last Updated**: Deployment Guide v1.0
**Backend API**: https://healthclassique.tech-bridge.app
**Status**: Ready for Production Deployment

