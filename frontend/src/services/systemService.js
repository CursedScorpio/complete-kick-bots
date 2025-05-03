import api from './api';

// System service for system-related API calls
const systemService = {
  // Get system health
  getSystemHealth: async () => {
    const response = await api.get('/system/health');
    return response.data;
  },
  
  // Get system metrics
  getSystemMetrics: async () => {
    const response = await api.get('/system/metrics');
    return response.data;
  },
  
  // Get resource manager metrics
  getResourceManagerMetrics: async () => {
    const response = await api.get('/system/resources');
    return response.data;
  },
  
  // Update resource manager configuration
  updateResourceManagerConfig: async (config) => {
    const response = await api.put('/system/resources/config', config);
    return response.data;
  },
  
  // Trigger a resource check
  triggerResourceCheck: async () => {
    const response = await api.post('/system/resources/check');
    return response.data;
  },
  
  // Trigger stopping idle viewers
  triggerStopIdleViewers: async (force = false) => {
    const response = await api.post('/system/resources/stop-idle', { force });
    return response.data;
  },
  
  // Poll system metrics with auto-reconnection
  pollSystemMetrics: (callback, interval = 10000) => {
    let isPolling = true;
    let timeoutId = null;
    
    const poll = async () => {
      if (!isPolling) return;
      
      try {
        const data = await systemService.getSystemMetrics();
        callback(null, data);
      } catch (error) {
        callback(error, null);
      }
      
      // Only schedule the next poll if we're still polling
      if (isPolling) {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
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
  }
};

export default systemService; 