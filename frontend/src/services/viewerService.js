// src/services/viewerService.js
import api from './api';

// Viewer service for specific viewer-related API calls
const viewerService = {
  // Get all viewers
  getAllViewers: async () => {
    const response = await api.get('/viewers');
    return response.data;
  },
  
  // Get viewer by ID
  getViewerById: async (viewerId) => {
    const response = await api.get(`/viewers/${viewerId}`);
    return response.data;
  },
  
  // Update a viewer
  updateViewer: async (viewerId, viewerData) => {
    const response = await api.put(`/viewers/${viewerId}`, viewerData);
    return response.data;
  },
  
  // Stop a viewer
  stopViewer: async (viewerId) => {
    const response = await api.post(`/viewers/${viewerId}/stop`);
    return response.data;
  },
  
  // Get viewer status
  getViewerStatus: async (viewerId) => {
    const response = await api.get(`/viewers/${viewerId}/status`);
    return response.data;
  },
  
  // Take a screenshot
  takeScreenshot: async (viewerId) => {
    const response = await api.post(`/viewers/${viewerId}/screenshot`);
    return response.data;
  },
  
  // Take a screenshot of a specific tab
  takeTabScreenshot: async (viewerId, tabIndex) => {
    const response = await api.post(`/viewers/${viewerId}/tab-screenshot`, { tabIndex });
    return response.data;
  },
  
  // Add a new tab to a viewer
  addTab: async (viewerId) => {
    const response = await api.post(`/viewers/${viewerId}/add-tab`);
    return response.data;
  },
  
  // Close a tab
  closeTab: async (viewerId, tabIndex) => {
    const response = await api.post(`/viewers/${viewerId}/close-tab`, { tabIndex });
    return response.data;
  },
  
  // Get tab statistics
  getTabStats: async (viewerId) => {
    const response = await api.get(`/viewers/${viewerId}/tab-stats`);
    return response.data;
  },
  
  // Force lowest quality for a specific tab
  forceTabLowestQuality: async (viewerId, tabIndex) => {
    const response = await api.post(`/viewers/${viewerId}/force-tab-lowest-quality`, { tabIndex });
    return response.data;
  },
  
  // Set maximum number of tabs
  setMaxTabs: async (viewerId, maxTabs) => {
    const response = await api.put(`/viewers/${viewerId}`, { maxTabs });
    return response.data;
  },
  
  // Get viewer logs
  getViewerLogs: async (viewerId) => {
    const response = await api.get(`/viewers/${viewerId}/logs`);
    return response.data;
  },
  
  // Poll viewer status (with automatic reconnection)
  pollViewerStatus: (viewerId, callback, interval = 15000) => {
    let isPolling = true;
    let timeoutId = null;
    
    const poll = async () => {
      if (!isPolling) return;
      
      try {
        const data = await viewerService.getViewerStatus(viewerId);
        callback(null, data);
      } catch (error) {
        callback(error, null);
      }
      
      // Only schedule the next poll if we're still polling
      if (isPolling) {
        // Clear any existing timeout to prevent multiple polling
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        // Set a new timeout with the proper interval
        timeoutId = setTimeout(poll, interval);
      }
    };
    
    // Start polling with the initial call
    poll();
    
    // Return function to stop polling
    return () => {
      isPolling = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
  },
  
  // Get screenshot URL
  getScreenshotUrl: (path) => {
    // If the path already starts with a slash, use it as is
    if (path && path.startsWith('/')) {
      return `${api.defaults.baseURL}${path}`;
    }
    
    // Otherwise, assume it's just a filename and use the old format
    return `${api.defaults.baseURL}/viewers/screenshots/${path}`;
  },
};

export default viewerService;