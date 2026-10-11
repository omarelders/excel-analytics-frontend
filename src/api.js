import axios from 'axios';
import { API_BASE_URL } from './config/apiBaseUrl';
import { addToSyncQueue } from './utils/offlineStorage';

// API Configuration
// In development, the Vite proxy handles /api routes
// In production, set VITE_API_URL environment variable
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ========== REQUEST INTERCEPTOR ==========
// Mutations are the only requests that are held back, because a read that fails offline
// fails the same way whether it was queued or not.
const MUTATION_METHODS = ['post', 'put', 'delete', 'patch'];

const QUEUED_OFFLINE_ERROR = {
  isOffline: true,
  isQueued: true,
  message: 'You are offline. Changes have been saved locally and will sync when you are back online.',
};

api.interceptors.request.use(
  async (config) => {
    // Check for offline status (except for sync requests)
    if (!navigator.onLine && !config._isSyncRequest) {
      // For mutations (POST, PUT, DELETE), queue the request
      if (MUTATION_METHODS.includes(config.method?.toLowerCase())) {
        try {
          await addToSyncQueue({
            url: config.url,
            method: config.method,
            data: config.data,
            params: config.params,
            headers: config.headers,
          });
        } catch (e) {
          // The change was not stored, and the device is offline, so sending it now
          // cannot succeed either. Falling through used to lose it here while the user
          // was told it had been saved for later.
          console.error('Failed to queue offline request:', e);

          return Promise.reject({
            isOffline: true,
            isUnqueued: true,
            message:
              `You are offline and this change could not be saved on this device, so it was not sent. ` +
              `Go back online and try again. (${e?.message ?? 'could not store it offline'})`,
          });
        }

        // Notify the application that the queue has updated
        window.dispatchEvent(new Event('sync-queue-updated'));

        // Reject with a specific offline error that components can handle
        return Promise.reject(QUEUED_OFFLINE_ERROR);
      }
    }

    // Add auth token if available (for future use)
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    console.error('[API] Request error:', error);
    return Promise.reject(error);
  }
);

// ========== RESPONSE INTERCEPTOR ==========
api.interceptors.response.use(
  (response) => {
    // Successful response - just return it
    return response;
  },
  (error) => {
    const { response } = error;
    
    // Network error (no response)
    if (!response) {
      // The request interceptor already knows what happened to a mutation it held
      // back, and its message is the one the user has to see: "saved locally and
      // will sync", or "could not be saved, so it was not sent".
      if (error?.isQueued || error?.isUnqueued) {
        return Promise.reject(error);
      }

      console.error('[API] Network error - server unreachable');
      // You could dispatch a global notification here
      return Promise.reject({
        ...error,
        message: 'Unable to connect to server. Please check your internet connection.',
      });
    }
    
    const { status, data } = response;
    
    // Handle specific HTTP status codes
    switch (status) {
      case 401:
        // Unauthorized - clear token and redirect to login (if auth is implemented)
        console.warn('[API] 401 Unauthorized - session expired or invalid');
        localStorage.removeItem('authToken');
        // Could redirect to login: window.location.href = '/login';
        break;
        
      case 403:
        // Forbidden
        console.warn('[API] 403 Forbidden - access denied');
        break;
        
      case 404:
        // Not found
        console.warn('[API] 404 Not Found:', error.config?.url);
        break;
        
      case 422:
        // Validation error
        console.warn('[API] 422 Validation Error:', data?.detail || data);
        break;
        
      case 500:
        // Server error
        console.error('[API] 500 Internal Server Error:', data?.detail || 'Unknown server error');
        // Could show a toast notification here
        break;
        
      case 502:
      case 503:
      case 504:
        // Gateway/Service errors
        console.error(`[API] ${status} Server temporarily unavailable`);
        break;
        
      default:
        console.error(`[API] Error ${status}:`, data?.detail || error.message);
    }
    
    // Return the error with enhanced message
    const enhancedError = {
      ...error,
      status,
      detail: data?.detail || error.message,
      isApiError: true,
    };
    
    return Promise.reject(enhancedError);
  }
);

export default api;
