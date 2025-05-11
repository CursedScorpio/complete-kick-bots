// src/components/Viewer/ViewerDetail.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import viewerService from '../../services/viewerService';
import Card from '../UI/Card';
import Button from '../UI/Button';
import StatusBadge from '../UI/StatusBadge';
import Spinner from '../UI/Spinner';

const ViewerDetail = ({ viewerId }) => {
  const {
    selectedViewer,
    setSelectedViewer,
    stopViewer,
    updateViewer,
    takeViewerScreenshot,
    fetchViewerDetails,
  } = useAppContext();
  
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [stopPolling, setStopPolling] = useState(null);
  const [streamUrl, setStreamUrl] = useState('');
  const [isStreamFormVisible, setIsStreamFormVisible] = useState(false);
  const [viewerLogs, setViewerLogs] = useState([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logsInterval, setLogsInterval] = useState(null);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [maxTabs, setMaxTabs] = useState(1);
  const [isMaxTabsFormVisible, setIsMaxTabsFormVisible] = useState(false);
  
  const navigate = useNavigate();
  
  // Fetch viewer details on mount
  useEffect(() => {
    const loadViewerDetails = async () => {
      setIsLoading(true);
      try {
        await fetchViewerDetails(viewerId);
      } catch (error) {
        console.error('Failed to fetch viewer details:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    if (viewerId) {
      loadViewerDetails();
    }
  }, [viewerId, fetchViewerDetails]);
  
  // Set max tabs when selected viewer changes
  useEffect(() => {
    if (selectedViewer) {
      setMaxTabs(selectedViewer.maxTabs || 1);
    }
  }, [selectedViewer]);
  
  // Start/stop polling based on viewer status
  useEffect(() => {
    // Clean up function for previous polling
    if (stopPolling) {
      stopPolling();
      setStopPolling(null);
      setIsPolling(false);
    }

    if (
      selectedViewer &&
      (selectedViewer.status === 'starting' ||
        selectedViewer.status === 'stopping' ||
        selectedViewer.status === 'running')
    ) {
      setIsPolling(true);
      
      const stopPollingFn = viewerService.pollViewerStatus(
        selectedViewer._id,
        (error, data) => {
          if (error) {
            console.error('Polling error:', error);
          } else if (data) {
            setSelectedViewer(data);
          }
        },
        15000
      );
      
      setStopPolling(() => stopPollingFn);
    }
    
    return () => {
      if (stopPolling) {
        stopPolling();
      }
    };
  }, [selectedViewer?._id, selectedViewer?.status]);
  
  // Fetch logs when viewer is first selected and set up interval polling
  useEffect(() => {
    // Clean up previous interval
    if (logsInterval) {
      clearInterval(logsInterval);
      setLogsInterval(null);
    }

    const fetchLogs = async () => {
      if (!selectedViewer) return;
      
      setIsLoadingLogs(true);
      try {
        const logs = await viewerService.getViewerLogs(selectedViewer._id);
        setViewerLogs(logs);
      } catch (error) {
        console.error('Failed to fetch viewer logs:', error);
      } finally {
        setIsLoadingLogs(false);
      }
    };
    
    // Initial fetch
    if (selectedViewer) {
      fetchLogs();
      
      // Set up interval for fetching logs (every 30 seconds)
      const interval = setInterval(fetchLogs, 30000);
      setLogsInterval(interval);
    }
    
    // Clean up interval when component unmounts or viewer changes
    return () => {
      if (logsInterval) {
        clearInterval(logsInterval);
        setLogsInterval(null);
      }
    };
  }, [selectedViewer?._id]);
  
  const handleBack = () => {
    navigate('/viewers');
  };
  
  const handleStopViewer = async () => {
    try {
      await stopViewer(viewerId);
    } catch (error) {
      console.error('Failed to stop viewer:', error);
    }
  };
  
  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      await fetchViewerDetails(viewerId);
      
      // Refresh logs too
      const logs = await viewerService.getViewerLogs(viewerId);
      setViewerLogs(logs);
    } catch (error) {
      console.error('Failed to refresh viewer details:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleStreamUrlChange = (e) => {
    setStreamUrl(e.target.value);
  };
  
  const handleSetStream = async (e) => {
    e.preventDefault();
    
    if (!streamUrl.trim()) return;
    
    try {
      await updateViewer(viewerId, { streamUrl });
      setIsStreamFormVisible(false);
      setStreamUrl('');
    } catch (error) {
      console.error('Failed to set stream:', error);
    }
  };
  
  const handleCancelStreamForm = () => {
    setIsStreamFormVisible(false);
    setStreamUrl('');
  };
  
  const handleTakeScreenshot = async () => {
    try {
      if (selectedViewer?.tabs && selectedViewer.tabs.length > 0) {
        await viewerService.takeTabScreenshot(viewerId, activeTabIndex);
      } else {
        await takeViewerScreenshot(viewerId);
      }
      // Refresh viewer details to get the new screenshot URL
      setTimeout(() => {
        fetchViewerDetails(viewerId);
      }, 1000);
    } catch (error) {
      console.error('Failed to take screenshot:', error);
    }
  };
  
  const handleMaxTabsChange = (e) => {
    const value = parseInt(e.target.value, 10);
    setMaxTabs(value);
  };
  
  const handleSetMaxTabs = async (e) => {
    e.preventDefault();
    
    if (maxTabs < 1 || maxTabs > 10) return;
    
    try {
      await viewerService.setMaxTabs(viewerId, maxTabs);
      setIsMaxTabsFormVisible(false);
      await fetchViewerDetails(viewerId);
    } catch (error) {
      console.error('Failed to set max tabs:', error);
    }
  };
  
  const handleCancelMaxTabsForm = () => {
    setIsMaxTabsFormVisible(false);
    setMaxTabs(selectedViewer?.maxTabs || 1);
  };
  
  const handleAddTab = async () => {
    try {
      await viewerService.addTab(viewerId);
      await fetchViewerDetails(viewerId);
      // Set active tab to the newly created tab
      if (selectedViewer && selectedViewer.tabs) {
        setActiveTabIndex(selectedViewer.tabs.length);
      }
    } catch (error) {
      console.error('Failed to add tab:', error);
    }
  };
  
  const handleCloseTab = async (tabIndex) => {
    try {
      await viewerService.closeTab(viewerId, tabIndex);
      
      // If closing the active tab, switch to the previous tab
      if (tabIndex === activeTabIndex && activeTabIndex > 0) {
        setActiveTabIndex(activeTabIndex - 1);
      } else if (tabIndex < activeTabIndex) {
        // If closing a tab before the active tab, adjust the active tab index
        setActiveTabIndex(activeTabIndex - 1);
      }
      
      await fetchViewerDetails(viewerId);
    } catch (error) {
      console.error('Failed to close tab:', error);
    }
  };
  
  const handleTabClick = (tabIndex) => {
    setActiveTabIndex(tabIndex);
  };
  
  const handleForceTabLowestQuality = async (tabIndex) => {
    try {
      await viewerService.forceTabLowestQuality(viewerId, tabIndex);
      await fetchViewerDetails(viewerId);
    } catch (error) {
      console.error('Failed to force lowest quality for tab:', error);
    }
  };
  
  // Loading state
  if (isLoading && !selectedViewer) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }
  
  // Not found state
  if (!selectedViewer) {
    return (
      <div className="p-4">
        <div className="flex mb-4">
          <Button onClick={handleBack} variant="secondary">
            Back
          </Button>
        </div>
        <Card>
          <div className="p-4 text-center">
            <h2 className="text-xl font-semibold text-gray-700">Viewer not found</h2>
          </div>
        </Card>
      </div>
    );
  }
  
  // Get screenshot URL for the active tab
  const getActiveTabScreenshotUrl = () => {
    if (selectedViewer.tabs && selectedViewer.tabs[activeTabIndex] && selectedViewer.tabs[activeTabIndex].lastScreenshotUrl) {
      return viewerService.getScreenshotUrl(selectedViewer.tabs[activeTabIndex].lastScreenshotUrl);
    }
    
    if (selectedViewer.lastScreenshotUrl) {
      return viewerService.getScreenshotUrl(selectedViewer.lastScreenshotUrl);
    }
    
    return null;
  };
  
  // Get the screenshot timestamp for the active tab
  const getActiveTabScreenshotTimestamp = () => {
    if (selectedViewer.tabs && selectedViewer.tabs[activeTabIndex] && selectedViewer.tabs[activeTabIndex].lastScreenshotTimestamp) {
      return new Date(selectedViewer.tabs[activeTabIndex].lastScreenshotTimestamp).toLocaleString();
    }
    
    if (selectedViewer.lastScreenshotTimestamp) {
      return new Date(selectedViewer.lastScreenshotTimestamp).toLocaleString();
    }
    
    return 'Never';
  };
  
  return (
    <div className="p-4">
      {/* Header with back button and actions */}
      <div className="flex justify-between mb-4">
        <Button onClick={handleBack} variant="secondary">
          Back
        </Button>
        <div className="flex space-x-2">
          {selectedViewer.status === 'running' && (
            <>
              <Button onClick={() => setIsStreamFormVisible(true)} variant="primary">
                Change Stream
              </Button>
              <Button onClick={handleStopViewer} variant="danger">
                Stop Viewer
              </Button>
            </>
          )}
          <Button onClick={handleRefresh} variant="secondary">
            Refresh
          </Button>
        </div>
      </div>
      
      {/* Viewer details card */}
      <Card className="mb-4">
        <div className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-700">{selectedViewer.name}</h2>
            <StatusBadge status={selectedViewer.status} />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <h3 className="text-lg font-semibold mb-2">Viewer Details</h3>
              <div className="space-y-2">
                <div>
                  <span className="font-medium">Status:</span> {selectedViewer.status}
                  {isPolling && <span className="ml-2 text-gray-500 text-sm">(Polling...)</span>}
                </div>
                <div>
                  <span className="font-medium">Box:</span>{' '}
                  {selectedViewer.box ? selectedViewer.box.name : 'Not assigned'}
                </div>
                <div>
                  <span className="font-medium">IP Address:</span>{' '}
                  {selectedViewer.box ? selectedViewer.box.ipAddress : 'N/A'}
                </div>
                <div>
                  <span className="font-medium">Streaming:</span>{' '}
                  {selectedViewer.streamUrl ? (
                    <a
                      href={selectedViewer.streamUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline"
                    >
                      {selectedViewer.streamer}
                    </a>
                  ) : (
                    'Not streaming'
                  )}
                </div>
                <div className="flex items-center">
                  <span className="font-medium mr-2">Max Tabs:</span> {selectedViewer.maxTabs || 1}
                  {selectedViewer.status === 'idle' && (
                    <Button
                      onClick={() => setIsMaxTabsFormVisible(true)}
                      variant="secondary"
                      size="xs"
                      className="ml-2"
                    >
                      Edit
                    </Button>
                  )}
                </div>
                <div>
                  <span className="font-medium">Active Tabs:</span>{' '}
                  {selectedViewer.tabs ? selectedViewer.tabs.length : 0}
                </div>
                {selectedViewer.error && (
                  <div className="text-red-500">
                    <span className="font-medium">Error:</span> {selectedViewer.error}
                  </div>
                )}
              </div>
            </div>
            
            <div>
              <h3 className="text-lg font-semibold mb-2">Playback Status</h3>
              {selectedViewer.tabs && selectedViewer.tabs.length > 0 && selectedViewer.tabs[activeTabIndex]?.playbackStatus ? (
                <div className="space-y-2">
                  <div>
                    <span className="font-medium">Playing:</span>{' '}
                    {selectedViewer.tabs[activeTabIndex].playbackStatus.isPlaying ? 'Yes' : 'No'}
                  </div>
                  <div>
                    <span className="font-medium">Quality:</span>{' '}
                    {selectedViewer.tabs[activeTabIndex].playbackStatus.quality || 'Unknown'}
                  </div>
                  <div>
                    <span className="font-medium">Resolution:</span>{' '}
                    {selectedViewer.tabs[activeTabIndex].playbackStatus.resolution || 'Unknown'}
                  </div>
                  <div>
                    <span className="font-medium">Buffering:</span>{' '}
                    {selectedViewer.tabs[activeTabIndex].playbackStatus.buffering ? 'Yes' : 'No'}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <span className="font-medium">Playing:</span>{' '}
                    {selectedViewer.playbackStatus.isPlaying ? 'Yes' : 'No'}
                  </div>
                  <div>
                    <span className="font-medium">Quality:</span>{' '}
                    {selectedViewer.playbackStatus.quality || 'Unknown'}
                  </div>
                  <div>
                    <span className="font-medium">Resolution:</span>{' '}
                    {selectedViewer.playbackStatus.resolution || 'Unknown'}
                  </div>
                  <div>
                    <span className="font-medium">Buffering:</span>{' '}
                    {selectedViewer.playbackStatus.buffering ? 'Yes' : 'No'}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Tab Management Section */}
          {selectedViewer.status === 'running' && (
            <div className="mt-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold">Tabs</h3>
                {selectedViewer.tabs && selectedViewer.tabs.length < (selectedViewer.maxTabs || 1) && (
                  <Button onClick={handleAddTab} variant="primary" size="sm">
                    Add Tab
                  </Button>
                )}
              </div>
              
              {/* Tab Navigation */}
              {selectedViewer.tabs && selectedViewer.tabs.length > 0 ? (
                <div className="mb-4">
                  <div className="flex border-b border-gray-200">
                    {selectedViewer.tabs.map((tab, index) => (
                      <div
                        key={index}
                        className={`cursor-pointer py-2 px-4 relative ${
                          activeTabIndex === index
                            ? 'border-b-2 border-blue-500 text-blue-600'
                            : 'text-gray-600 hover:text-gray-800'
                        }`}
                        onClick={() => handleTabClick(index)}
                      >
                        Tab {index + 1}
                        {selectedViewer.tabs.length > 1 && (
                          <button
                            className="ml-2 text-gray-400 hover:text-red-500"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCloseTab(index);
                            }}
                          >
                            ×
                          </button>
                        )}
                        <StatusBadge
                          status={tab.status || 'idle'}
                          className="absolute -top-2 -right-2 scale-75"
                        />
                      </div>
                    ))}
                  </div>
                  
                  {/* Tab Actions */}
                  <div className="mt-4 flex space-x-2">
                    <Button onClick={handleTakeScreenshot} variant="primary" size="sm">
                      Take Screenshot
                    </Button>
                    <Button
                      onClick={() => handleForceTabLowestQuality(activeTabIndex)}
                      variant="secondary"
                      size="sm"
                    >
                      Force Lowest Quality
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-gray-500 mb-4">No tabs available</div>
              )}
            </div>
          )}
          
          {/* Screenshot section */}
          <div className="mt-4">
            <h3 className="text-lg font-semibold mb-2">Screenshot</h3>
            <div className="flex items-center mb-2">
              <span className="text-sm text-gray-500">
                Last taken: {getActiveTabScreenshotTimestamp()}
              </span>
              {selectedViewer.status === 'running' && (
                <Button
                  onClick={handleTakeScreenshot}
                  variant="primary"
                  size="sm"
                  className="ml-auto"
                >
                  Take Screenshot
                </Button>
              )}
            </div>
            
            {getActiveTabScreenshotUrl() ? (
              <div className="border rounded-lg overflow-hidden">
                <img
                  src={getActiveTabScreenshotUrl()}
                  alt="Viewer Screenshot"
                  className="max-w-full h-auto"
                />
              </div>
            ) : (
              <div className="border rounded-lg p-8 text-center text-gray-500">
                No screenshot available
              </div>
            )}
          </div>
        </div>
      </Card>
      
      {/* Stream URL Form Dialog */}
      {isStreamFormVisible && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Set Stream URL</h3>
            <form onSubmit={handleSetStream}>
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Stream URL
                </label>
                <input
                  type="text"
                  value={streamUrl}
                  onChange={handleStreamUrlChange}
                  placeholder="https://kick.com/streamer"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <p className="text-sm text-gray-500 mt-1">
                  Supported format: https://kick.com/streamer
                </p>
              </div>
              <div className="flex justify-end space-x-2">
                <Button onClick={handleCancelStreamForm} variant="secondary" type="button">
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Set Stream
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Max Tabs Form Dialog */}
      {isMaxTabsFormVisible && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Set Maximum Tabs</h3>
            <form onSubmit={handleSetMaxTabs}>
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Maximum Tabs
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={maxTabs}
                  onChange={handleMaxTabsChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <p className="text-sm text-gray-500 mt-1">
                  Set the maximum number of tabs this viewer can have (1-10)
                </p>
              </div>
              <div className="flex justify-end space-x-2">
                <Button onClick={handleCancelMaxTabsForm} variant="secondary" type="button">
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Save
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Logs section */}
      <Card>
        <div className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Logs</h3>
            {isLoadingLogs && <Spinner size="sm" />}
          </div>
          <div className="bg-gray-800 text-white font-mono text-sm p-4 rounded-md h-64 overflow-y-auto">
            {viewerLogs.length > 0 ? (
              viewerLogs.map((log, index) => (
                <div
                  key={index}
                  className={`mb-1 ${
                    log.level === 'error'
                      ? 'text-red-400'
                      : log.level === 'warn'
                      ? 'text-yellow-400'
                      : 'text-green-400'
                  }`}
                >
                  <span className="text-gray-400">
                    {new Date(log.timestamp).toLocaleString()}
                  </span>{' '}
                  [{log.level.toUpperCase()}] {log.message}
                </div>
              ))
            ) : (
              <div className="text-gray-400">No logs available</div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default ViewerDetail;
 