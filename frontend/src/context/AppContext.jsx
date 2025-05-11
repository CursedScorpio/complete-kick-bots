// src/context/AppContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';
import api from '../services/api';
import viewerService from '../services/viewerService';

// Create context
const AppContext = createContext();

// Custom hook to use the context
export const useAppContext = () => useContext(AppContext);

export const AppProvider = ({ children }) => {
  // State for boxes
  const [boxes, setBoxes] = useState([]);
  const [boxesLoading, setBoxesLoading] = useState(true);
  const [boxesError, setBoxesError] = useState(null);
  
  // State for viewers
  const [viewers, setViewers] = useState([]);
  const [viewersLoading, setViewersLoading] = useState(true);
  const [viewersError, setViewersError] = useState(null);
  
  // State for VPN configs
  const [vpnConfigs, setVpnConfigs] = useState([]);
  const [vpnLoading, setVpnLoading] = useState(true);
  const [vpnError, setVpnError] = useState(null);
  
  // Selected items
  const [selectedBox, setSelectedBox] = useState(null);
  const [selectedViewer, setSelectedViewer] = useState(null);
  
  // Stats
  const [stats, setStats] = useState({
    totalBoxes: 0,
    activeBoxes: 0,
    totalViewers: 0,
    activeViewers: 0,
    errorBoxes: 0,
    errorViewers: 0,
  });

  // References for tracking initialization and preventing loops
  const initialFetchDone = useRef(false);
  const boxesInterval = useRef(null);
  const viewersInterval = useRef(null);
  
  // Update stats based on current data
  const updateStats = useCallback(() => {
    const activeBoxes = boxes.filter(box => box.status === 'running').length;
    const errorBoxes = boxes.filter(box => box.status === 'error').length;
    const activeViewers = viewers.filter(viewer => viewer.status === 'running').length;
    const errorViewers = viewers.filter(viewer => viewer.status === 'error').length;
    
    setStats({
      totalBoxes: boxes.length,
      activeBoxes,
      totalViewers: viewers.length,
      activeViewers,
      errorBoxes,
      errorViewers,
    });
  }, [boxes, viewers]);
  
  // Fetch all boxes - independent of viewers state
  const fetchBoxes = useCallback(async () => {
    try {
      setBoxesLoading(true);
      setBoxesError(null);
      
      const response = await api.get('/boxes');
      setBoxes(response.data);
    } catch (error) {
      console.error('Error fetching boxes:', error);
      setBoxesError(error.message || 'Failed to fetch boxes');
      toast.error('Failed to fetch boxes');
    } finally {
      setBoxesLoading(false);
    }
  }, []); // No dependencies
  
  // Fetch all viewers - independent of boxes state
  const fetchViewers = useCallback(async () => {
    try {
      setViewersLoading(true);
      setViewersError(null);
      
      const response = await api.get('/viewers');
      setViewers(response.data);
    } catch (error) {
      console.error('Error fetching viewers:', error);
      setViewersError(error.message || 'Failed to fetch viewers');
      toast.error('Failed to fetch viewers');
    } finally {
      setViewersLoading(false);
    }
  }, []); // No dependencies
  
  // Fetch all VPN configs
  const fetchVpnConfigs = useCallback(async () => {
    try {
      setVpnLoading(true);
      setVpnError(null);
      
      const response = await api.get('/vpn/configs');
      setVpnConfigs(response.data);
    } catch (error) {
      console.error('Error fetching VPN configs:', error);
      setVpnError(error.message || 'Failed to fetch VPN configurations');
      toast.error('Failed to fetch VPN configurations');
    } finally {
      setVpnLoading(false);
    }
  }, []);
  
  // Initial data fetch - only run once
  useEffect(() => {
    const fetchAllData = async () => {
      if (initialFetchDone.current) return;
      
      try {
        // Fetch data in parallel
        const [boxesResponse, viewersResponse, vpnResponse] = await Promise.all([
          api.get('/boxes'),
          api.get('/viewers'),
          api.get('/vpn/configs').catch(error => {
            console.error('Error fetching VPN configs:', error);
            return { data: [] };
          })
        ]);
        
        // Update state
        setBoxes(boxesResponse.data);
        setViewers(viewersResponse.data);
        setVpnConfigs(vpnResponse.data);
        
        // Reset loading states
        setBoxesLoading(false);
        setViewersLoading(false);
        setVpnLoading(false);
        
        // Mark as initialized
        initialFetchDone.current = true;
      } catch (error) {
        console.error('Error during initial data fetch:', error);
        toast.error('Failed to load initial data');
        setBoxesLoading(false);
        setViewersLoading(false);
        setVpnLoading(false);
      }
    };
    
    fetchAllData();
    
    return () => {
      // Clear any pending intervals
      if (boxesInterval.current) clearInterval(boxesInterval.current);
      if (viewersInterval.current) clearInterval(viewersInterval.current);
    };
  }, []); // Run only once on mount
  
  // Update stats whenever boxes or viewers change
  useEffect(() => {
    updateStats();
  }, [boxes, viewers, updateStats]);
  
  // Set up polling after initial data is loaded
  useEffect(() => {
    if (!initialFetchDone.current) return;
    
    // Only set up polling intervals if they don't exist yet
    if (!boxesInterval.current) {
      // Increased polling interval from 10 seconds to 30 seconds
      boxesInterval.current = setInterval(fetchBoxes, 30000);
    }
    
    if (!viewersInterval.current) {
      // Increased polling interval from 10 seconds to 30 seconds
      viewersInterval.current = setInterval(fetchViewers, 30000);
    }
    
    return () => {
      if (boxesInterval.current) clearInterval(boxesInterval.current);
      if (viewersInterval.current) clearInterval(viewersInterval.current);
    };
  }, [fetchBoxes, fetchViewers, initialFetchDone.current]);
  
  // Box operations
  const createBox = async (boxData) => {
    try {
      // Ensure viewersPerBox is passed as a number
      const formattedData = {
        ...boxData,
        viewersPerBox: parseInt(boxData.viewersPerBox, 10) || 10
      };
      
      const response = await api.post('/boxes', formattedData);
      setBoxes(prevBoxes => [...prevBoxes, response.data]);
      toast.success('Box created successfully');
      return response.data;
    } catch (error) {
      console.error('Error creating box:', error);
      toast.error(error.response?.data?.message || 'Failed to create box');
      throw error;
    }
  };
  
  const updateBox = async (boxId, boxData) => {
    try {
      // Ensure viewersPerBox is passed as a number
      const formattedData = {
        ...boxData,
        viewersPerBox: parseInt(boxData.viewersPerBox, 10) || undefined
      };
      
      const response = await api.put(`/boxes/${boxId}`, formattedData);
      setBoxes(prevBoxes => 
        prevBoxes.map(box => (box._id === boxId ? response.data : box))
      );
      toast.success('Box updated successfully');
      return response.data;
    } catch (error) {
      console.error('Error updating box:', error);
      toast.error(error.response?.data?.message || 'Failed to update box');
      throw error;
    }
  };
  
  const deleteBox = async (boxId) => {
    try {
      await api.delete(`/boxes/${boxId}`);
      setBoxes(prevBoxes => prevBoxes.filter(box => box._id !== boxId));
      if (selectedBox?._id === boxId) {
        setSelectedBox(null);
      }
      toast.success('Box deleted successfully');
    } catch (error) {
      console.error('Error deleting box:', error);
      toast.error(error.response?.data?.message || 'Failed to delete box');
      throw error;
    }
  };
  
  const startBox = async (boxId) => {
    try {
      const response = await api.post(`/boxes/${boxId}/start`);
      
      // Update the box status immediately to starting
      setBoxes(prevBoxes => 
        prevBoxes.map(box => 
          box._id === boxId 
            ? { ...box, status: 'starting' } 
            : box
        )
      );
      
      toast.info('Box is starting...');
      
      // Update the selected box if it's the one being started
      if (selectedBox?._id === boxId) {
        setSelectedBox({ ...selectedBox, status: 'starting' });
      }
      
      // Refresh after a short delay to get updated status
      setTimeout(() => {
        fetchBoxes();
        fetchViewers();
      }, 3000);
      
      return response.data;
    } catch (error) {
      console.error('Error starting box:', error);
      toast.error(error.response?.data?.message || 'Failed to start box');
      throw error;
    }
  };
  
  const stopBox = async (boxId) => {
    try {
      const response = await api.post(`/boxes/${boxId}/stop`);
      
      // Update the box status immediately to stopping
      setBoxes(prevBoxes => 
        prevBoxes.map(box => 
          box._id === boxId 
            ? { ...box, status: 'stopping' } 
            : box
        )
      );
      
      toast.info('Box is stopping...');
      
      // Update the selected box if it's the one being stopped
      if (selectedBox?._id === boxId) {
        setSelectedBox({ ...selectedBox, status: 'stopping' });
      }
      
      // Refresh after a short delay to get updated status
      setTimeout(() => {
        fetchBoxes();
        fetchViewers();
      }, 3000);
      
      return response.data;
    } catch (error) {
      console.error('Error stopping box:', error);
      toast.error(error.response?.data?.message || 'Failed to stop box');
      throw error;
    }
  };
  
  // Viewer operations
  const updateViewer = async (viewerId, viewerData) => {
    try {
      const response = await viewerService.updateViewer(viewerId, viewerData);
      
      // Update local state
      setViewers(prevViewers => 
        prevViewers.map(viewer => 
          viewer._id === viewerId ? response : viewer
        )
      );
      
      // If this is the selected viewer, update that too
      if (selectedViewer && selectedViewer._id === viewerId) {
        setSelectedViewer(response);
      }
      
      toast.success('Viewer updated successfully');
      return response;
    } catch (error) {
      console.error('Error updating viewer:', error);
      toast.error(error.response?.data?.message || 'Failed to update viewer');
      throw error;
    }
  };
  
  const stopViewer = async (viewerId) => {
    try {
      const response = await api.post(`/viewers/${viewerId}/stop`);
      
      // Update the viewer status immediately to stopping
      setViewers(prevViewers => 
        prevViewers.map(viewer => 
          viewer._id === viewerId 
            ? { ...viewer, status: 'stopping' } 
            : viewer
        )
      );
      
      toast.info('Viewer is stopping...');
      
      // Update the selected viewer if it's the one being stopped
      if (selectedViewer?._id === viewerId) {
        setSelectedViewer({ ...selectedViewer, status: 'stopping' });
      }
      
      // Refresh after a short delay to get updated status
      setTimeout(() => {
        fetchViewers();
      }, 3000);
      
      return response.data;
    } catch (error) {
      console.error('Error stopping viewer:', error);
      toast.error(error.response?.data?.message || 'Failed to stop viewer');
      throw error;
    }
  };
  
  const takeViewerScreenshot = async (viewerId) => {
    try {
      const response = await api.post(`/viewers/${viewerId}/screenshot`);
      
      toast.success('Screenshot taken successfully');
      
      // Update the selected viewer if it's the one being screenshotted
      if (selectedViewer?._id === viewerId) {
        fetchViewerDetails(viewerId);
      }
      
      return response.data;
    } catch (error) {
      console.error('Error taking viewer screenshot:', error);
      toast.error(error.response?.data?.message || 'Failed to take screenshot');
      throw error;
    }
  };
  
  // VPN operations
  const testVpnConnection = async (configName) => {
    try {
      const response = await api.post('/vpn/test', { configName });
      toast.success(`VPN connection test successful: ${response.data.ip} (${response.data.location})`);
      return response.data;
    } catch (error) {
      console.error('Error testing VPN connection:', error);
      toast.error(error.response?.data?.message || 'Failed to test VPN connection');
      throw error;
    }
  };
  
  const uploadVpnConfig = async (formData) => {
    try {
      const response = await api.post('/vpn/configs', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      fetchVpnConfigs();
      toast.success('VPN configuration uploaded successfully');
      return response.data;
    } catch (error) {
      console.error('Error uploading VPN config:', error);
      toast.error(error.response?.data?.message || 'Failed to upload VPN configuration');
      throw error;
    }
  };
  
  const deleteVpnConfig = async (configName) => {
    try {
      await api.delete(`/vpn/configs/${configName}`);
      setVpnConfigs(prevConfigs => 
        prevConfigs.filter(config => config.name !== configName)
      );
      toast.success('VPN configuration deleted successfully');
    } catch (error) {
      console.error('Error deleting VPN config:', error);
      toast.error(error.response?.data?.message || 'Failed to delete VPN configuration');
      throw error;
    }
  };
  
  // Get details for a specific box
  const fetchBoxDetails = async (boxId) => {
    try {
      const response = await api.get(`/boxes/${boxId}`);
      setSelectedBox(response.data);
      return response.data;
    } catch (error) {
      console.error('Error fetching box details:', error);
      toast.error('Failed to fetch box details');
      throw error;
    }
  };
  
  // Get details for a specific viewer
  const fetchViewerDetails = async (viewerId) => {
    try {
      const response = await api.get(`/viewers/${viewerId}`);
      setSelectedViewer(response.data);
      return response.data;
    } catch (error) {
      console.error('Error fetching viewer details:', error);
      toast.error('Failed to fetch viewer details');
      throw error;
    }
  };
  
  // Set the maximum number of tabs for a viewer
  const setMaxTabs = async (viewerId, maxTabs) => {
    try {
      const response = await viewerService.setMaxTabs(viewerId, maxTabs);
      
      // Update local state
      setViewers(prevViewers => 
        prevViewers.map(viewer => 
          viewer._id === viewerId ? response : viewer
        )
      );
      
      // If this is the selected viewer, update that too
      if (selectedViewer && selectedViewer._id === viewerId) {
        setSelectedViewer(response);
      }
      
      toast.success('Max tabs updated successfully');
      return response;
    } catch (error) {
      console.error('Error setting max tabs:', error);
      toast.error(error.response?.data?.message || 'Failed to set max tabs');
      throw error;
    }
  };

  // Add a new tab to a viewer
  const addViewerTab = async (viewerId) => {
    try {
      const response = await viewerService.addTab(viewerId);
      
      // Update the selected viewer if this is the current one
      if (selectedViewer && selectedViewer._id === viewerId) {
        // We'll need to fetch the full viewer details to get the updated tabs
        const updatedViewer = await viewerService.getViewerById(viewerId);
        setSelectedViewer(updatedViewer);
      }
      
      toast.success('Tab added successfully');
      return response;
    } catch (error) {
      console.error('Error adding tab:', error);
      toast.error(error.response?.data?.message || 'Failed to add tab');
      throw error;
    }
  };

  // Close a tab
  const closeViewerTab = async (viewerId, tabIndex) => {
    try {
      const response = await viewerService.closeTab(viewerId, tabIndex);
      
      // Update the selected viewer if this is the current one
      if (selectedViewer && selectedViewer._id === viewerId) {
        // We'll need to fetch the full viewer details to get the updated tabs
        const updatedViewer = await viewerService.getViewerById(viewerId);
        setSelectedViewer(updatedViewer);
      }
      
      toast.success('Tab closed successfully');
      return response;
    } catch (error) {
      console.error('Error closing tab:', error);
      toast.error(error.response?.data?.message || 'Failed to close tab');
      throw error;
    }
  };

  // Take a screenshot of a specific tab
  const takeTabScreenshot = async (viewerId, tabIndex) => {
    try {
      const response = await viewerService.takeTabScreenshot(viewerId, tabIndex);
      
      // Update the selected viewer if this is the current one
      if (selectedViewer && selectedViewer._id === viewerId) {
        // We'll need to fetch the full viewer details to get the updated screenshot
        const updatedViewer = await viewerService.getViewerById(viewerId);
        setSelectedViewer(updatedViewer);
      }
      
      toast.success('Screenshot taken successfully');
      return response;
    } catch (error) {
      console.error('Error taking tab screenshot:', error);
      toast.error(error.response?.data?.message || 'Failed to take screenshot');
      throw error;
    }
  };

  // Force lowest quality for a specific tab
  const forceTabLowestQuality = async (viewerId, tabIndex) => {
    try {
      const response = await viewerService.forceTabLowestQuality(viewerId, tabIndex);
      toast.success('Forced lowest quality for tab');
      return response;
    } catch (error) {
      console.error('Error forcing lowest quality:', error);
      toast.error(error.response?.data?.message || 'Failed to force lowest quality');
      throw error;
    }
  };

  // Get tab statistics
  const getTabStats = async (viewerId) => {
    try {
      return await viewerService.getTabStats(viewerId);
    } catch (error) {
      console.error('Error getting tab stats:', error);
      toast.error(error.response?.data?.message || 'Failed to get tab statistics');
      throw error;
    }
  };

  // Context value
  const contextValue = {
    // Data
    boxes,
    viewers,
    vpnConfigs,
    selectedBox,
    selectedViewer,
    stats,
    
    // Loading states
    boxesLoading,
    viewersLoading,
    vpnLoading,
    
    // Error states
    boxesError,
    viewersError,
    vpnError,
    
    // Actions
    setSelectedBox,
    setSelectedViewer,
    fetchBoxes,
    fetchViewers,
    fetchVpnConfigs,
    fetchBoxDetails,
    fetchViewerDetails,
    
    // Box operations
    createBox,
    updateBox,
    deleteBox,
    startBox,
    stopBox,
    
    // Viewer operations
    updateViewer,
    stopViewer,
    takeViewerScreenshot,
    
    // VPN operations
    testVpnConnection,
    uploadVpnConfig,
    deleteVpnConfig,
    
    // Tab operations
    setMaxTabs,
    addViewerTab,
    closeViewerTab,
    takeTabScreenshot,
    forceTabLowestQuality,
    getTabStats,
  };
  
  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
};