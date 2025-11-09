# 🔧 Redis Connection Error Fix

## Problem
Backend is trying to connect to Redis on port 6379, but Redis is not running.

## Solution

### Option 1: Start Redis Service (Recommended)

**On Windows (XAMPP):**
```bash
# Download and install Redis for Windows
# Or use WSL (Windows Subsystem for Linux)

# If using WSL:
wsl
sudo service redis-server start

# Or install Redis for Windows:
# Download from: https://github.com/microsoftarchive/redis/releases
# Or use: https://github.com/tporadowski/redis/releases
```

**On Linux/Mac:**
```bash
# Start Redis service
sudo service redis-server start

# Or using systemd:
sudo systemctl start redis

# Or using Homebrew (Mac):
brew services start redis
```

### Option 2: Disable Redis in Laravel (Temporary Fix)

If you don't need Redis right now, you can temporarily disable it:

**In your Laravel `.env` file:**
```env
# Change from:
CACHE_DRIVER=redis
SESSION_DRIVER=redis
QUEUE_CONNECTION=redis

# To:
CACHE_DRIVER=file
SESSION_DRIVER=file
QUEUE_CONNECTION=sync
```

Then restart your Laravel server:
```bash
php artisan config:clear
php artisan cache:clear
```

### Option 3: Check Redis Configuration

**Check your Laravel `.env` file:**
```env
REDIS_HOST=127.0.0.1
REDIS_PASSWORD=null
REDIS_PORT=6379
```

Make sure these match your Redis installation.

## Verify Redis is Running

```bash
# Test Redis connection
redis-cli ping
# Should return: PONG

# Or check if port is listening
netstat -an | findstr 6379  # Windows
netstat -an | grep 6379      # Linux/Mac
```

## Quick Fix for Development

The fastest solution for development:

1. **Install Redis for Windows** (if on Windows):
   - Download: https://github.com/tporadowski/redis/releases
   - Install and start the service

2. **Or disable Redis temporarily**:
   - Change `.env` to use `file` driver instead of `redis`
   - Restart Laravel server

The linting fixes we did are completely separate and didn't cause this issue.

