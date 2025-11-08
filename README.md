# TechChat App 💬

A modern messaging application built with React Native and Expo, featuring real-time chat, group messaging, file sharing, and push notifications.

![CI](https://github.com/shemnd/TechChat-App/workflows/CI/badge.svg)
![Code Quality](https://github.com/shemnd/TechChat-App/workflows/Code%20Quality/badge.svg)
![Build Android](https://github.com/shemnd/TechChat-App/workflows/Build%20Android/badge.svg)

## Features

- 💬 **Real-time Messaging**: Individual and group conversations
- 📎 **File Sharing**: Images, videos, documents, and voice messages
- 🔔 **Push Notifications**: Stay connected with instant notifications
- 👥 **Group Management**: Create and manage group chats
- 🎨 **Dark Mode**: Beautiful dark and light themes
- 🔐 **Secure Authentication**: Token-based authentication
- 📱 **Cross-platform**: iOS and Android support
- 🔄 **Reply to Messages**: Reply to specific messages in conversations
- 🖼️ **Profile Pictures**: User and group avatars
- ✅ **Read Receipts**: See when messages are read

## Getting Started

### Prerequisites

- Node.js 20 or higher
- npm or yarn
- Expo CLI
- iOS Simulator (for iOS development) or Android Emulator (for Android development)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/shemnd/TechChat-App.git
   cd TechChat-App
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure API endpoints**
   - Update `config/app.config.ts` with your backend API URLs
   - For development, ensure your Laravel backend is running

4. **Start the development server**
   ```bash
   npm start
   ```

5. **Run on device/emulator**
   - Press `i` for iOS simulator
   - Press `a` for Android emulator
   - Scan QR code with Expo Go app (for physical devices)

## Development

### Project Structure

```
TechChat-App/
├── app/                    # App screens (expo-router)
│   ├── (auth)/            # Authentication screens
│   ├── chat/              # Chat screens
│   └── ...
├── components/            # Reusable components
├── context/               # React contexts (Auth, Theme, Notifications)
├── services/              # API services
├── utils/                 # Utility functions
├── config/                # Configuration files
└── assets/                # Images, icons, fonts
```

### Available Scripts

- `npm start` - Start Expo development server
- `npm run lint` - Run ESLint
- `npm run android` - Start on Android
- `npm run ios` - Start on iOS
- `npm run web` - Start on web

### Building for Production

See [BUILD_GUIDE.md](./BUILD_GUIDE.md) for detailed build instructions.

**Quick build commands:**
```bash
# Android
eas build --profile production --platform android

# iOS
eas build --profile production --platform ios
```

## CI/CD

This project uses GitHub Actions for continuous integration and quality checks:

- **CI**: Automatically runs linting, type checking, and installs packages on every push/PR
- **Build**: Automated Android builds via EAS
- **Release**: Automatic release creation on version tags
- **Security**: Weekly security vulnerability scans
- **Quality**: Code quality checks (console statements, TODOs, etc.)

**Note:** Deployment to servers is done manually. GitHub Actions focuses on code quality and building apps.

See [GITHUB_ACTIONS_SETUP.md](./GITHUB_ACTIONS_SETUP.md) for setup instructions.

## Documentation

- [Build Guide](./BUILD_GUIDE.md) - How to build for production
- [GitHub Actions Setup](./GITHUB_ACTIONS_SETUP.md) - CI/CD configuration
- [Production Readiness](./production_readiness.md) - Production checklist

## Contributing

1. Create a feature branch from `develop`
2. Make your changes
3. Ensure CI passes (linting, type checking)
4. Create a Pull Request
5. Wait for review and approval

## Technology Stack

- **Framework**: React Native with Expo
- **Routing**: Expo Router (file-based routing)
- **Styling**: NativeWind (Tailwind CSS for React Native)
- **State Management**: React Context API
- **API Client**: Axios
- **Notifications**: Expo Notifications
- **Build Service**: EAS Build

## License

Private project - All rights reserved

## Support

For issues and questions, please open an issue on GitHub or contact the development team.
