// src/services/boxService.js
import api from './api';

// Box service for specific box-related API calls
const boxService = {
  // Get all boxes
  getAllBoxes: async () => {
    const response = await api.get('/boxes');
    return response.data;
  },
  
  // Get box by ID
  getBoxById: async (boxId) => {
    const response = await api.get(`/boxes/${boxId}`);
    return response.data;
  },
  
  // Create a new box
  createBox: async (boxData) => {
    const response = await api.post('/boxes', boxData);
    return response.data;
  },
  
  // Update a box
  updateBox: async (boxId, boxData) => {
    const response = await api.put(`/boxes/${boxId}`, boxData);
    return response.data;
  },
  
  // Delete a box
  deleteBox: async (boxId) => {
    await api.delete(`/boxes/${boxId}`);
  },
  
  // Start a box
  startBox: async (boxId) => {
    const response = await api.post(`/boxes/${boxId}/start`);
    return response.data;
  },
  
  // Stop a box
  stopBox: async (boxId) => {
    const response = await api.post(`/boxes/${boxId}/stop`);
    return response.data;
  },
  
  // Get box status
  getBoxStatus: async (boxId) => {
    const response = await api.get(`/boxes/${boxId}/status`);
    return response.data;
  },
  
  // Refresh box IP
  refreshBoxIp: async (boxId) => {
    const response = await api.post(`/boxes/${boxId}/refresh-ip`);
    return response.data;
  },
  
  // Poll box status (with automatic reconnection)
  pollBoxStatus: (boxId, callback, interval = 15000) => {
    let isPolling = true;
    
    const poll = async () => {
      if (!isPolling) return;
      
      try {
        const data = await boxService.getBoxStatus(boxId);
        callback(null, data);
      } catch (error) {
        callback(error, null);
      }
      
      if (isPolling) {
        setTimeout(poll, interval);
      }
    };
    
    // Start polling
    poll();
    
    // Return function to stop polling
    return () => {
      isPolling = false;
    };
  },
};

export default boxService;