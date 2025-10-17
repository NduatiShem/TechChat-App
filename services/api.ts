import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';


// API Base URL - Configured for TechChat app
// TEMPORARY: Hardcode the URL for testing
const API_BASE_URL = 'http://192.168.100.25:8000/api';

// Debug logging
console.log('🔧 API Configuration:', {
  isDev: __DEV__,
  platform: Platform.OS,
  apiBaseUrl: API_BASE_URL
});

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  timeout: 30000, // 30 second timeout for debugging
  transformResponse: [function (data) {
    // Ensure proper JSON parsing
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return parsed;
      } catch (e) {
        console.error('TransformResponse - Parse error:', e);
        console.error('TransformResponse - Raw data length:', data.length);
        console.error('TransformResponse - Raw data preview:', data.substring(0, 200) + '...');
        console.error('TransformResponse - Raw data end:', data.substring(Math.max(0, data.length - 100)));
        
        // Try to fix common truncation issues
        if (data.includes('[') && !data.endsWith(']')) {
          console.log('Attempting to fix truncated JSON array...');
          try {
            const fixedData = data + ']';
            const parsed = JSON.parse(fixedData);
            console.log('Successfully parsed fixed JSON array');
            return parsed;
          } catch (fixError) {
            console.error('Failed to parse fixed JSON array:', fixError);
          }
        }
        
        if (data.includes('{') && !data.endsWith('}')) {
          console.log('Attempting to fix truncated JSON object...');
          try {
            const fixedData = data + '}';
            const parsed = JSON.parse(fixedData);
            console.log('Successfully parsed fixed JSON object');
            return parsed;
          } catch (fixError) {
            console.error('Failed to parse fixed JSON object:', fixError);
          }
        }
        
        return data;
      }
    }
    return data;
  }],
});

// API Base URL configured

// Request interceptor to add auth token
api.interceptors.request.use(
  async (config) => {
    console.log('🚀 API Request:', {
      method: config.method?.toUpperCase(),
      url: config.url,
      baseURL: config.baseURL,
      fullURL: `${config.baseURL}${config.url}`,
      headers: config.headers,
      data: config.data
    });
    
    const token = await SecureStore.getItemAsync('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    console.error('❌ Request interceptor error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor to handle auth errors and JSON parsing
api.interceptors.response.use(
  (response) => {
    console.log('📥 API Response:', {
      status: response.status,
      url: response.config.url,
      data: response.data
    });
    
    // Handle case where response.data is a JSON string instead of parsed object
    if (typeof response.data === 'string') {
      try {
        response.data = JSON.parse(response.data);
      } catch (parseError) {
        console.warn('Response interceptor - Failed to parse JSON string:', parseError);
        console.warn('Response interceptor - Raw data length:', response.data.length);
        console.warn('Response interceptor - Raw data preview:', response.data.substring(0, 200) + '...');
        
        // Try to fix common truncation issues
        if (response.data.includes('[') && !response.data.endsWith(']')) {
          console.log('Response interceptor - Attempting to fix truncated JSON array...');
          try {
            const fixedData = response.data + ']';
            response.data = JSON.parse(fixedData);
            console.log('Response interceptor - Successfully parsed fixed JSON array');
          } catch (fixError) {
            console.error('Response interceptor - Failed to parse fixed JSON array:', fixError);
          }
        }
        
        if (response.data.includes('{') && !response.data.endsWith('}')) {
          console.log('Response interceptor - Attempting to fix truncated JSON object...');
          try {
            const fixedData = response.data + '}';
            response.data = JSON.parse(fixedData);
            console.log('Response interceptor - Successfully parsed fixed JSON object');
          } catch (fixError) {
            console.error('Response interceptor - Failed to parse fixed JSON object:', fixError);
          }
        }
      }
    }
    
    // Handle Laravel API response structure
    // Some endpoints return: { status: "success", data: {...} }
    // Others return data directly: { token: "...", user: {...} }
    // Only extract data if it's wrapped in a status object
    if (response.data && response.data.status === 'success' && response.data.data !== undefined) {
      response.data = response.data.data;
    }
    // If response.data doesn't have a status field, keep it as is
    
    return response;
  },
  async (error) => {
    console.error('❌ API Response Error:', {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      config: {
        method: error.config?.method,
        url: error.config?.url,
        baseURL: error.config?.baseURL,
        fullURL: `${error.config?.baseURL}${error.config?.url}`,
      }
    });
    
    if (error.response?.status === 401) {
      // Token expired or invalid, redirect to login
      await SecureStore.deleteItemAsync('auth_token');
      router.replace('/(auth)/login');
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  
  register: (name: string, email: string, phone: string, password: string, password_confirmation: string) =>
    api.post('/auth/register', { name, email, phone, password, password_confirmation }),
  
  logout: () => api.post('/auth/logout'),
  
  refreshToken: () => api.post('/auth/refresh'),
  
  getProfile: () => api.get('/users/me'),
  
  updateProfile: (data: any) => api.put('/user/profile', data),
  
  changePassword: (current_password: string, new_password: string, new_password_confirmation: string) =>
    api.post('/user/change-password', { current_password, new_password, new_password_confirmation }),
  
  registerFcmToken: (fcmToken: string) => api.post('/user/fcm-token', { fcm_token: fcmToken }),
  
  uploadAvatar: (formData: FormData) => api.post('/user/avatar', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    timeout: 300000, // 5 minute timeout for file uploads
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    onUploadProgress: (progressEvent) => {
      if (progressEvent.total) {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        console.log('Upload progress:', percentCompleted + '%');
      }
    },
  }),
};

// Messages API
export const messagesAPI = {
  getConversations: () => api.get('/conversations'),
  
  getConversationMessages: (conversationId: number, type: 'individual' | 'group') => 
    api.get(`/conversations/${conversationId}?type=${type}`),
  
  getByUser: (userId: number, page: number = 1, perPage: number = 10) => 
    api.get(`/messages/user/${userId}?page=${page}&per_page=${perPage}`),
  
  getByGroup: (groupId: number, page: number = 1, perPage: number = 10) => 
    api.get(`/messages/group/${groupId}?page=${page}&per_page=${perPage}`),
  
  sendMessage: (data: FormData | {
    message?: string;
    receiver_id?: number;
    group_id?: number;
    reply_to_id?: number;
    attachments?: any[];
  }, config?: any) => {
    // If data is FormData, send it directly with multipart headers
    if (data instanceof FormData) {
      return api.post('/messages', data, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        ...config
      });
    }
    // Otherwise, send as regular JSON
    return api.post('/messages', data, config);
  },
  
  markAsRead: (conversationId: number, type: 'individual' | 'group') => 
    api.put(`/conversations/${conversationId}/read?type=${type}`),
  
  getUnreadCount: () => api.get('/messages/unread-count'),
  
  deleteMessage: (messageId: number) => api.delete(`/messages/${messageId}`),
};

// Conversations API
export const conversationsAPI = {
  getAll: () => api.get('/conversations'),
};

// Users API
export const usersAPI = {
  getAll: (search?: string) => api.get(`/users${search ? `?search=${search}` : ''}`),
  
  getUser: (id: number) => api.get(`/users/${id}`),
  
  getOnlineUsers: () => api.get('/users/online'),
  
  updateLastSeen: () => api.post('/users/last-seen'),
  
  me: () => api.get('/users/me'),
};

// Groups API
export const groupsAPI = {
  getAll: () => api.get('/groups'),
  
  create: (data: { name: string; description?: string; avatar?: string; members: number[] }) =>
    api.post('/groups', data),
  
  getGroup: (id: number) => api.get(`/groups/${id}`),
  
  update: (groupId: number, data: { name?: string; description?: string }) =>
    api.put(`/groups/${groupId}`, data),
  
  addMembers: (groupId: number, members: number[]) =>
    api.post(`/groups/${groupId}/members`, { members }),
  
  removeMembers: (groupId: number, members: number[]) =>
    api.delete(`/groups/${groupId}/members`, { data: { members } }),
  
  leaveGroup: (groupId: number) => api.post(`/groups/${groupId}/leave`),
  
  delete: (groupId: number) => api.delete(`/groups/${groupId}`),
};

export default api; 