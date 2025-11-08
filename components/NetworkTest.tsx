/**
 * Network Connectivity Test Component
 * Use this to verify your device can reach the backend server
 */
import { secureStorage } from '@/utils/secureStore';
import { AppConfig } from '@/config/app.config';
import { useState } from 'react';
import { Alert, Text, TouchableOpacity, View, ActivityIndicator, Platform } from 'react-native';

export const NetworkTest = () => {
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<string>('');

  const testNetwork = async () => {
    setTesting(true);
    setResults('Testing...\n');

    try {
      // Get API URL
      let apiUrl: string;
      if (__DEV__) {
        if (Platform.OS === 'android') {
          apiUrl = AppConfig.api.development.physical;
        } else {
          apiUrl = AppConfig.api.development.ios;
        }
      } else {
        apiUrl = AppConfig.api.production;
      }

      const baseUrl = apiUrl.replace('/api', '');
      const testUrl = `${baseUrl}/api/conversations`;

      let log = `Testing: ${testUrl}\n`;
      log += `Platform: ${Platform.OS}\n\n`;
      setResults(log);

      // Get token
      const token = await secureStorage.getItem('auth_token');
      log += `Token: ${token ? 'Found (' + token.length + ' chars)' : 'NOT FOUND'}\n\n`;
      setResults(log);

      // Test 1: Basic connectivity
      log += 'TEST 1: Basic Connectivity...\n';
      setResults(log);
      try {
        const response = await fetch(testUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token || ''}`,
            'Accept': 'application/json',
          },
          timeout: 5000,
        } as any);
        log += `✓ Server reachable! Status: ${response.status}\n\n`;
        setResults(log);
      } catch (e: any) {
        log += `✗ FAILED: ${e.message}\n\n`;
        setResults(log);
        throw e;
      }

      // Test 2: Try avatar endpoint (OPTIONS)
      const avatarUrl = `${baseUrl}/api/user/avatar`;
      log += `TEST 2: Avatar Endpoint (${avatarUrl})...\n`;
      setResults(log);
      try {
        const response = await fetch(avatarUrl, {
          method: 'OPTIONS',
          headers: {
            'Authorization': `Bearer ${token || ''}`,
            'Accept': 'application/json',
          },
        });
        log += `✓ Endpoint exists! Status: ${response.status}\n\n`;
        setResults(log);
      } catch (e: any) {
        log += `⚠ Warning: ${e.message}\n\n`;
        setResults(log);
      }

      // Test 3: Direct IP ping (if possible)
      log += 'TEST 3: URL Analysis...\n';
      try {
        const urlObj = new URL(testUrl);
        log += `Host: ${urlObj.host}\n`;
        log += `Protocol: ${urlObj.protocol}\n`;
        log += `Port: ${urlObj.port || 'default'}\n`;
        log += `Path: ${urlObj.pathname}\n`;
      } catch {
        log += `Could not parse URL\n`;
      }

      Alert.alert('Network Test Complete', 'Check results below');
    } catch (error: any) {
      const errorMsg = `Network test failed:\n${error.message}`;
      setResults(prev => prev + `\n✗ ${errorMsg}`);
      Alert.alert('Test Failed', errorMsg);
    } finally {
      setTesting(false);
    }
  };

  return (
    <View style={{ padding: 20, backgroundColor: '#f5f5f5', margin: 10, borderRadius: 8 }}>
      <TouchableOpacity
        onPress={testNetwork}
        disabled={testing}
        style={{
          backgroundColor: '#007AFF',
          padding: 15,
          borderRadius: 8,
          marginBottom: 10,
        }}
      >
        {testing ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={{ color: 'white', textAlign: 'center', fontWeight: 'bold' }}>
            Test Network Connectivity
          </Text>
        )}
      </TouchableOpacity>

      {results ? (
        <View style={{ backgroundColor: 'white', padding: 10, borderRadius: 8, marginTop: 10 }}>
          <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{results}</Text>
        </View>
      ) : null}
    </View>
  );
};
