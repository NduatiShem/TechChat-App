import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Button, Text, View } from 'react-native';
import { AppConfig } from '../config/app.config';

export const DirectAvatarUpload = ({ onSuccess }: { onSuccess?: () => void }) => {
  const [status, setStatus] = useState('Ready');
  const [isUploading, setIsUploading] = useState(false);

  const uploadAvatar = async () => {
    try {
      setStatus('Starting...');
      setIsUploading(true);

      // Request permission
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission required', 'Please grant access to your photo library');
        setStatus('Permission denied');
        setIsUploading(false);
        return;
      }

      setStatus('Selecting image...');
      
      // Pick image
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled) {
        setStatus('Cancelled');
        setIsUploading(false);
        return;
      }

      const asset = result.assets[0];
      setStatus('Image selected');

      // Get token
      const token = await SecureStore.getItemAsync('auth_token');
      if (!token) {
        Alert.alert('Error', 'You need to be logged in');
        setStatus('Not logged in');
        setIsUploading(false);
        return;
      }

      // Create form data
      const formData = new FormData();
      
      // Add file
      formData.append('avatar', {
        uri: asset.uri,
        name: asset.fileName || 'avatar.jpg',
        type: asset.type || 'image/jpeg',
      } as any);

      setStatus('Uploading using XMLHttpRequest...');
      
      // Use XMLHttpRequest directly
      const xhr = new XMLHttpRequest();
      
      // Set up upload progress
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          setStatus(`Uploading: ${percentComplete}%`);
        }
      };
      
      // Create promise to handle async
      await new Promise<void>((resolve, reject) => {
        xhr.onload = function() {
          if (xhr.status >= 200 && xhr.status < 300) {
            setStatus(`Upload successful (${xhr.status})`);
            resolve();
          } else {
            setStatus(`Server error: ${xhr.status}`);
            reject(new Error(`Server error: ${xhr.status}`));
          }
        };
        
        xhr.onerror = function() {
          setStatus('Network error');
          console.error('XHR ERROR:', xhr.statusText);
          reject(new Error('Network error'));
        };
        
        // Get URL from config
        const baseUrl = AppConfig.api.development.physical;
        const url = `${baseUrl}/user/avatar`;
        
        // Open connection
        xhr.open('POST', url);
        
        // Set headers
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Accept', 'application/json');
        
        // Send request
        xhr.send(formData);
      });
      
      setStatus('Upload completed');
      Alert.alert('Success', 'Avatar updated successfully!');
      
      if (onSuccess) {
        onSuccess();
      }
      
    } catch (error: any) {
      console.error('Upload error:', error);
      setStatus(`Error: ${error.message}`);
      Alert.alert('Upload Failed', error.message || 'Unknown error');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <View style={{ padding: 10 }}>
      <Text style={{ marginBottom: 10 }}>Status: {status}</Text>
      {isUploading ? (
        <ActivityIndicator size="small" color="#0000ff" />
      ) : (
        <Button title="Upload Avatar Directly" onPress={uploadAvatar} />
      )}
    </View>
  );
};

export default DirectAvatarUpload;
