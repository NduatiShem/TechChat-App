import { secureStorage } from '@/utils/secureStore';
import axios from 'axios';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { AppConfig } from '../config/app.config';

// API Base URL - Configured for TechChat app
// Use the configuration from AppConfig
const getApiBaseUrl = () => {
  if (__DEV__) {
    // For Android devices (both physical and emulator in Expo Go), use the physical device URL
    // This is because Expo Go on physical devices needs your computer's network IP
    if (Platform.OS === 'android') {
      return AppConfig.api.development.physical;
    } else if (Platform.OS === 'ios') {
      return AppConfig.api.development.ios;
    }
  }
  // In production, use the production URL
  return AppConfig.api.production;
};

const API_BASE_URL = getApiBaseUrl();

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Accept': 'application/json',
  },
  timeout: 30000,
  transformResponse: [function (data) {
    // Ensure proper JSON parsing
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return parsed;
      } catch (e) {
        // Try to fix common truncation issues
        if (data.includes('[') && !data.endsWith(']')) {
          try {
            const fixedData = data + ']';
            const parsed = JSON.parse(fixedData);
            return parsed;
          } catch (fixError) {
            // Silent fail
          }
        }
        
        if (data.includes('{') && !data.endsWith('}')) {
          try {
            const fixedData = data + '}';
            const parsed = JSON.parse(fixedData);
            return parsed;
          } catch (fixError) {
            // Silent fail
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
    const token = await secureStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle auth errors and JSON parsing
api.interceptors.response.use(
  (response) => {
    // Handle case where response.data is a JSON string instead of parsed object
    if (typeof response.data === 'string') {
      try {
        response.data = JSON.parse(response.data);
      } catch (parseError) {
        // Try to fix common truncation issues
        if (response.data.includes('[') && !response.data.endsWith(']')) {
          try {
            const fixedData = response.data + ']';
            response.data = JSON.parse(fixedData);
          } catch (fixError) {
            // Silent fail
          }
        }
        
        if (response.data.includes('{') && !response.data.endsWith('}')) {
          try {
            const fixedData = response.data + '}';
            response.data = JSON.parse(fixedData);
          } catch (fixError) {
            // Silent fail
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
    // Handle 401 Unauthorized - redirect to login
    if (error.response?.status === 401) {
      // Token expired or invalid, redirect to login
      await secureStorage.deleteItem('auth_token');
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
  
  uploadAvatar: (formData: FormData) => {
    // Use EXACT same pattern as messagesAPI.sendMessage
    // If data is FormData, send it directly with multipart headers
    return api.post('/user/avatar', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  
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
  
  markMessagesAsRead: (userId: number) => 
    api.put(`/messages/mark-read/${userId}`),
  
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
  
  markMessagesAsRead: (groupId: number) => 
    api.post('/messages/mark-group-read', { groupId }),
  
  uploadAvatar: (groupId: number, formData: FormData) => {
    return api.post(`/groups/${groupId}/avatar`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
};

export default api; 