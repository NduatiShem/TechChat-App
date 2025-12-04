import { useEffect, useState, useRef } from 'react';
import * as Updates from 'expo-updates';
import { secureStorage } from '@/utils/secureStore';
import { AppState, AppStateStatus } from 'react-native';

const UPDATE_CHECK_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours
const LAST_CHECK_KEY = 'last_update_check';
const UPDATE_AVAILABLE_KEY = 'update_available';

interface UpdateCheckResult {
  isAvailable: boolean;
  isDownloaded: boolean;
}

/**
 * Hook for background update checking
 * Checks for updates after app is fully loaded, with throttling
 * Completely non-blocking - doesn't delay app startup
 */
export function useBackgroundUpdateCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const checkInProgressRef = useRef(false);

  const checkForUpdate = async (force: boolean = false): Promise<UpdateCheckResult> => {
    // Prevent multiple simultaneous checks
    if (checkInProgressRef.current) {
      console.log('🔄 Update check already in progress, skipping...');
      return { isAvailable: false, isDownloaded: false };
    }

    try {
      checkInProgressRef.current = true;
      setIsChecking(true);

      // Check if we should throttle (unless forced)
      if (!force) {
        const lastCheckTime = await secureStorage.getItem(LAST_CHECK_KEY);
        if (lastCheckTime) {
          const timeSinceLastCheck = Date.now() - parseInt(lastCheckTime, 10);
          if (timeSinceLastCheck < UPDATE_CHECK_INTERVAL) {
            const hoursRemaining = Math.ceil((UPDATE_CHECK_INTERVAL - timeSinceLastCheck) / (60 * 60 * 1000));
            console.log(`⏸️ Update check throttled. Next check in ~${hoursRemaining} hours`);
            return { isAvailable: false, isDownloaded: false };
          }
        }
      }

      console.log('🔄 Checking for updates...');

      // Check if update is available
      const update = await Updates.checkForUpdateAsync();

      if (update.isAvailable) {
        console.log('✅ Update available! Downloading...');

        // Download the update
        const fetchResult = await Updates.fetchUpdateAsync();

        if (fetchResult.isNew) {
          console.log('✅ Update downloaded successfully');
          
          // Store that update is available
          await secureStorage.setItem(UPDATE_AVAILABLE_KEY, 'true');
          setUpdateAvailable(true);

          return { isAvailable: true, isDownloaded: true };
        } else {
          console.log('⚠️ Update check completed but no new update');
          return { isAvailable: false, isDownloaded: false };
        }
      } else {
        console.log('✅ App is up to date');
        // Clear update available flag if we checked and there's no update
        await secureStorage.deleteItem(UPDATE_AVAILABLE_KEY);
        setUpdateAvailable(false);
        return { isAvailable: false, isDownloaded: false };
      }
    } catch (error: any) {
      console.error('❌ Error checking for updates:', error);
      // Don't throw - this is a background operation
      return { isAvailable: false, isDownloaded: false };
    } finally {
      // Update last check time
      await secureStorage.setItem(LAST_CHECK_KEY, Date.now().toString());
      setIsChecking(false);
      checkInProgressRef.current = false;
    }
  };

  const applyUpdate = async (): Promise<boolean> => {
    try {
      console.log('🔄 Applying update...');
      await Updates.reloadAsync();
      return true;
    } catch (error: any) {
      console.error('❌ Error applying update:', error);
      return false;
    }
  };

  // Check for updates when app becomes active (after initial load)
  useEffect(() => {
    // Only check if Updates is enabled (not in development)
    if (!Updates.isEnabled) {
      console.log('ℹ️ Updates are disabled (development mode)');
      return;
    }

    // Wait a bit after app loads to ensure everything is ready
    const initialDelay = setTimeout(() => {
      // Check if there's a previously downloaded update
      secureStorage.getItem(UPDATE_AVAILABLE_KEY).then((hasUpdate) => {
        if (hasUpdate === 'true') {
          console.log('ℹ️ Previously downloaded update detected');
          setUpdateAvailable(true);
        }
      });

      // Perform initial check (non-blocking)
      checkForUpdate().catch((error) => {
        console.error('Error in initial update check:', error);
      });
    }, 3000); // Wait 3 seconds after app loads

    // Listen for app state changes to check when app comes to foreground
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      // When app comes to foreground, check for updates (throttled)
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        console.log('🔄 App came to foreground, checking for updates...');
        checkForUpdate().catch((error) => {
          console.error('Error in foreground update check:', error);
        });
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      clearTimeout(initialDelay);
      subscription.remove();
    };
  }, []);

  return {
    updateAvailable,
    isChecking,
    checkForUpdate,
    applyUpdate,
  };
}

