import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { Alert, Button, Text, View, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

export const AvatarUploadTest = () => {
  const [status, setStatus] = React.useState('Ready');
  const [isUploading, setIsUploading] = React.useState(false);

  const testNetworkConnection = async () => {
    try {
      setStatus('Testing network connection...');
      
      // Check network state
      const netInfo = await NetInfo.fetch();
      
      setStatus(`Network: ${netInfo.type}, Connected: ${netInfo.isConnected ? 'Yes' : 'No'}`);
      
      // Test connectivity to server
      const { AppConfig } = await import('../config/app.config');
      const baseUrl = AppConfig.api.development.physical;
      
      setStatus(`Testing connection to ${baseUrl}...`);
      
      try {
        const response = await fetch(`${baseUrl}/ping`, { 
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          // Short timeout for quick feedback
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          setStatus(`Server ping successful: ${response.status}`);
        } else {
          setStatus(`Server ping failed: ${response.status}`);
        }
      } catch (error) {
        setStatus(`Server ping error: ${error.message}`);
        
        // Try connecting to the base URL without the path
        const serverUrl = baseUrl.replace(/\/api$/, '');
        setStatus(`Testing connection to base URL: ${serverUrl}...`);
        
        try {
          const baseResponse = await fetch(serverUrl, { 
            method: 'GET',
            signal: AbortSignal.timeout(5000)
          });
          setStatus(`Base URL connection: ${baseResponse.status}`);
        } catch (baseError) {
          setStatus(`Base URL connection failed: ${baseError.message}`);
        }
      }
    } catch (error) {
      setStatus(`Network test error: ${error.message}`);
    }
  };
  
  const testAvatarUpload = async () => {
    try {
      // Test network connection first
      await testNetworkConnection();
      
      setStatus('Requesting permission...');
      setIsUploading(true);

      // Request permission
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission required', 'Please grant access to your photo library');
        setStatus('Permission denied');
        setIsUploading(false);
        return;
      }

      setStatus('Picking image...');
      
      // Pick image
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled) {
        setStatus('Cancelled by user');
        setIsUploading(false);
        return;
      }

      const asset = result.assets[0];
      setStatus(`Image selected: ${asset.uri.substring(asset.uri.lastIndexOf('/') + 1)}`);

      // Check file size
      if (asset.fileSize && asset.fileSize > 2 * 1024 * 1024) {
        Alert.alert('Error', 'Image file size must be less than 2MB');
        setStatus('File too large');
        setIsUploading(false);
        return;
      }

       // Create FormData
       const formData = new FormData();
       
       // Ensure we have a valid file name with extension
       const fileName = asset.fileName || `avatar_${Date.now()}.jpg`;
       
       // Ensure we have a valid MIME type - critical for Laravel
       const fileType = asset.type || 'image/jpeg';
       
       setStatus(`Creating FormData with: ${fileName} (${fileType})`);
       
       // Create file object with proper content-type
       const fileObject = {
         uri: asset.uri,
         name: fileName,
         type: fileType,
       };
       
       setStatus('Adding file to FormData');
       
       // Add file with proper content-type
       formData.append('avatar', fileObject as any);
       
       // Add a dummy field to ensure FormData is properly constructed
       formData.append('_method', 'POST');
       
       setStatus('FormData created successfully');

       setStatus('Uploading avatar with XMLHttpRequest...');
       
       // Get token directly
       const { getToken } = await import('../utils/secureStore');
       const token = await getToken('auth_token');
       
       // Get base URL from config
       const { AppConfig } = await import('../config/app.config');
       const baseUrl = AppConfig.api.development.physical;
       
       // Create the full URL
       const url = `${baseUrl}/user/avatar`;
       
       setStatus(`Sending to: ${url}`);
       
       // Try a different approach with a direct fetch call
       try {
         setStatus('Trying direct fetch approach...');
         
         // Create a simple form with just a text field to test connectivity
         const testForm = new FormData();
         testForm.append('test_field', 'test_value');
         
         // Try a simple POST first to test connectivity
         setStatus('Testing POST with simple form data...');
         const testResponse = await fetch(url.replace('/avatar', '/ping'), {
           method: 'POST',
           headers: {
             'Authorization': `Bearer ${token}`,
             'Accept': 'application/json',
           },
           body: testForm,
         });
         
         setStatus(`Test POST status: ${testResponse.status}`);
         
         // Now try the actual file upload
         setStatus('Attempting file upload with fetch...');
         
         // Try with a different approach - using blob
         const response = await fetch(asset.uri);
         const blob = await response.blob();
         
         // Create a new form with the blob
         const blobForm = new FormData();
         blobForm.append('avatar', blob, fileName);
         
         setStatus('Sending blob-based FormData...');
         
         // Send the request
         const uploadResponse = await fetch(url, {
           method: 'POST',
           headers: {
             'Authorization': `Bearer ${token}`,
             'Accept': 'application/json',
           },
           body: blobForm,
         });
         
         setStatus(`Upload response status: ${uploadResponse.status}`);
         
         if (uploadResponse.ok) {
           setStatus('Upload completed successfully');
           Alert.alert('Success', 'Avatar updated successfully!');
         } else {
           const errorText = await uploadResponse.text();
           setStatus(`Upload failed: ${errorText}`);
           throw new Error(`Upload failed with status ${uploadResponse.status}`);
         }
       } catch (fetchError) {
         setStatus(`Fetch approach failed: ${fetchError.message}`);
         
         // Fall back to XMLHttpRequest
         setStatus('Falling back to XMLHttpRequest...');
         
         await new Promise<void>((resolve, reject) => {
           const xhr = new XMLHttpRequest();
           
           // Track upload progress
           xhr.upload.onprogress = (event) => {
             if (event.lengthComputable) {
               const percentComplete = Math.round((event.loaded / event.total) * 100);
               setStatus(`Uploading: ${percentComplete}%`);
             }
           };
           
           // Handle successful response
           xhr.onload = function() {
             setStatus(`Response received. Status: ${xhr.status}`);
             
             if (xhr.status >= 200 && xhr.status < 300) {
               try {
                 const response = JSON.parse(xhr.responseText);
                 setStatus('Upload completed successfully');
                 Alert.alert('Success', 'Avatar updated successfully!');
                 resolve();
               } catch (e) {
                 setStatus(`Error parsing response: ${e.message}`);
                 reject(new Error('Invalid JSON response'));
               }
             } else {
               try {
                 const errorData = JSON.parse(xhr.responseText);
                 setStatus(`Server error: ${JSON.stringify(errorData)}`);
                 reject(new Error(`Server error: ${xhr.status}`));
               } catch (e) {
                 setStatus(`Server error: ${xhr.status}, ${xhr.responseText}`);
                 reject(new Error(`Server error: ${xhr.status}`));
               }
             }
           };
           
           // Handle network errors
           xhr.onerror = function(e) {
             setStatus(`Network error: ${e instanceof Error ? e.message : 'Unknown error'}`);
             reject(new Error('Network request failed'));
           };
           
           // Handle timeouts
           xhr.ontimeout = function() {
             setStatus('Request timed out');
             reject(new Error('Request timed out'));
           };
           
           // Open connection
           xhr.open('POST', url);
           
           // Set headers
           xhr.setRequestHeader('Authorization', `Bearer ${token}`);
           xhr.setRequestHeader('Accept', 'application/json');
           
           // Set timeout
           xhr.timeout = 30000;
           
           // Send request
           setStatus('Sending XHR request...');
           xhr.send(formData);
         });
       }
       });
      
    } catch (error: any) {
      console.error('TEST: Avatar upload error:', error);
      
      let errorMessage = 'Failed to upload avatar';
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setStatus(`Error: ${errorMessage}`);
      Alert.alert('Upload Failed', errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <View style={{ padding: 20 }}>
      <Text style={{ marginBottom: 10, fontWeight: 'bold' }}>Avatar Upload Test</Text>
      <Text style={{ marginBottom: 20 }}>Status: {status}</Text>
      <Button 
        title={isUploading ? "Uploading..." : "Test Avatar Upload"} 
        onPress={testAvatarUpload} 
        disabled={isUploading} 
      />
    </View>
  );
};

export default AvatarUploadTest;
