const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Config plugin to set windowSoftInputMode to adjustResize in AndroidManifest.xml
 * This ensures the keyboard doesn't cover input fields in Android production builds
 */
const withAndroidKeyboard = (config) => {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const { manifest } = androidManifest;

    if (!manifest.application) {
      return config;
    }

    const application = manifest.application[0];
    if (!application.activity) {
      return config;
    }

    // Find the main activity and set windowSoftInputMode
    const mainActivity = application.activity.find(
      (activity) => activity.$['android:name'] === '.MainActivity'
    );

    if (mainActivity) {
      mainActivity.$['android:windowSoftInputMode'] = 'adjustResize';
    }

    // Also set it for all activities to be safe
    application.activity.forEach((activity) => {
      if (!activity.$['android:windowSoftInputMode']) {
        activity.$['android:windowSoftInputMode'] = 'adjustResize';
      }
    });

    return config;
  });
};

module.exports = withAndroidKeyboard;





