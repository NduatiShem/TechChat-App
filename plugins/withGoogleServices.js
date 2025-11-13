const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin to create google-services.json from EAS secret during prebuild
 * This runs during EAS Build before the Android project is generated
 */
const withGoogleServices = (config) => {
  // This runs synchronously during config evaluation
  const googleServicesBase64 = process.env.GOOGLE_SERVICES_JSON_BASE64;
  
  if (googleServicesBase64) {
    try {
      const decoded = Buffer.from(googleServicesBase64, 'base64').toString('utf-8');
      const filePath = path.join(process.cwd(), 'google-services.json');
      
      fs.writeFileSync(filePath, decoded, 'utf-8');
      console.log('✓ Created google-services.json from EAS secret');
    } catch (error) {
      console.error('✗ Failed to create google-services.json:', error);
    }
  } else {
    console.warn('⚠️ GOOGLE_SERVICES_JSON_BASE64 not set, skipping google-services.json creation');
  }
  
  return config;
};

module.exports = withGoogleServices;

