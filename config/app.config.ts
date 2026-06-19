// App Configuration for TechChat
export const AppConfig = {
  // App Information
  appName: 'TechChat',
  appVersion: '1.0.0',
  
  // API Configuration
  api: {
    development: {
      ios: 'http://127.0.0.1:8000/api',        // For iOS Simulator
      android: 'http://10.0.2.2:8000/api',     // For Android Emulator
      physical: 'http://192.168.100.65:8000/api', // For physical devices (your computer's IP)
    },
    production: 'https://healthclassique.tech-bridge.app/api',
  },
  
  // Feature Flags
  features: {
    enableDebugLogging: __DEV__,
    enableAnalytics: false,
    enablePushNotifications: true,
  },
  
  // App Settings
  settings: {
    messageTimeout: 10000, // 10 seconds
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxImageSize: 5 * 1024 * 1024, // 5MB
  },
};

export default AppConfig;

