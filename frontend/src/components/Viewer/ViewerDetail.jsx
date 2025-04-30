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
    viewerResources,
    fetchViewerResources,
    updateViewerResourceLimits,
  } = useAppContext();
  
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [stopPolling, setStopPolling] = useState(null);
  const [streamUrl, setStreamUrl] = useState('');
  const [isStreamFormVisible, setIsStreamFormVisible] = useState(false);
  const [viewerLogs, setViewerLogs] = useState([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logsInterval, setLogsInterval] = useState(null);
  const [isEditingLimits, setIsEditingLimits] = useState(false);
  const [limits, setLimits] = useState({
    cpuLimit: 100,
    memoryLimit: 500,
    networkLimit: 5
  });
  
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
      await takeViewerScreenshot(viewerId);
      // Refresh viewer details to get the new screenshot URL
      setTimeout(() => {
        fetchViewerDetails(viewerId);
      }, 1000);
    } catch (error) {
      console.error('Failed to take screenshot:', error);
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
      <div className="text-center py-12">
        <div className="text-danger-600 text-lg mb-4">Viewer not found</div>
        <Button variant="primary" onClick={handleBack}>
          Back to Viewers
        </Button>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center space-y-4 md:space-y-0">
        <div className="flex items-center">
          <button
            onClick={handleBack}
            className="mr-3 text-gray-400 hover:text-gray-500"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
            </svg>
          </button>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center">
              {selectedViewer.name}
              {isLoading && <Spinner size="sm" className="ml-2" />}
            </h2>
            <div className="flex items-center mt-1">
              <StatusBadge status={selectedViewer.status} />
              {selectedViewer.box && (
                <span className="ml-2 text-sm text-gray-500">
                  Box: {selectedViewer.box.name}
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex space-x-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
              </svg>
            }
          >
            Refresh
          </Button>
          
          {!isStreamFormVisible && selectedViewer.status === 'running' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsStreamFormVisible(true)}
            >
              Set Stream
            </Button>
          )}
          
          {selectedViewer.status === 'running' && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleTakeScreenshot}
            >
              Take Screenshot
            </Button>
          )}
          
          {(selectedViewer.status === 'running' || selectedViewer.status === 'starting') && (
            <Button
              variant="warning"
              size="sm"
              onClick={handleStopViewer}
            >
              Stop Viewer
            </Button>
          )}
        </div>
      </div>
      
      {/* Stream URL Form */}
      {isStreamFormVisible && (
        <Card>
          <form onSubmit={handleSetStream} className="space-y-3">
            <div>
              <label htmlFor="streamUrl" className="block text-sm font-medium text-gray-700">
                Stream URL
              </label>
              <input
                id="streamUrl"
                type="text"
                value={streamUrl}
                onChange={handleStreamUrlChange}
                placeholder="https://kick.com/streamername"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                Enter a valid Kick.com stream URL (e.g., https://kick.com/streamername)
              </p>
            </div>
            <div className="flex space-x-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
              >
                Set Stream
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCancelStreamForm}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
      
      {/* Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Viewer Details */}
        <Card title="Viewer Details">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-500">Status</label>
              <div className="mt-1">
                <StatusBadge status={selectedViewer.status} />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-500">Box</label>
              <div className="mt-1 text-sm">
                {selectedViewer.box?.name || 'Unknown'}
                {selectedViewer.box?.ipAddress && ` (${selectedViewer.box.ipAddress})`}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-500">Stream</label>
              <div className="mt-1 text-sm">
                {selectedViewer.streamUrl ? (
                  <a
                    href={selectedViewer.streamUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-600 hover:underline"
                  >
                    {selectedViewer.streamer || selectedViewer.streamUrl}
                  </a>
                ) : (
                  'No stream assigned'
                )}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-500">Chat Parsing</label>
              <div className="mt-1 text-sm">
                {selectedViewer.isParseChatEnabled ? (
                  <span className="text-success-600">Enabled</span>
                ) : (
                  <span className="text-gray-500">Disabled</span>
                )}
              </div>
            </div>
            
            {selectedViewer.playbackStatus && (
              <div>
                <label className="block text-sm font-medium text-gray-500">Playback Status</label>
                <div className="mt-1 text-sm">
                  {selectedViewer.playbackStatus.isPlaying ? (
                    <span className="text-success-600">Playing</span>
                  ) : (
                    <span className="text-gray-500">Not playing</span>
                  )}
                  {selectedViewer.playbackStatus.resolution && (
                    <span className="ml-2">({selectedViewer.playbackStatus.resolution})</span>
                  )}
                </div>
              </div>
            )}
            
            {selectedViewer.streamMetadata && selectedViewer.streamMetadata.title && (
              <div>
                <label className="block text-sm font-medium text-gray-500">Stream Title</label>
                <div className="mt-1 text-sm">{selectedViewer.streamMetadata.title}</div>
              </div>
            )}
            
            {selectedViewer.streamMetadata && selectedViewer.streamMetadata.game && (
              <div>
                <label className="block text-sm font-medium text-gray-500">Game</label>
                <div className="mt-1 text-sm">{selectedViewer.streamMetadata.game}</div>
              </div>
            )}
            
            {selectedViewer.error && (
              <div>
                <label className="block text-sm font-medium text-danger-500">Error</label>
                <div className="mt-1 text-sm text-danger-600 bg-danger-50 p-2 rounded-md">
                  {selectedViewer.error}
                </div>
              </div>
            )}
          </div>
        </Card>
        
        {/* Screenshot */}
        <Card title="Screenshot">
          {selectedViewer.lastScreenshotUrl ? (
            <div className="flex flex-col items-center">
              <img
                src={viewerService.getScreenshotUrl(selectedViewer.lastScreenshotUrl.split('/').pop())}
                alt="Viewer Screenshot"
                className="max-w-full h-auto border border-gray-200 rounded-md"
              />
              <div className="mt-2 text-xs text-gray-500">
                Last updated: {new Date(selectedViewer.lastScreenshotTimestamp).toLocaleString()}
              </div>
              {selectedViewer.status === 'running' && (
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-3"
                  onClick={handleTakeScreenshot}
                >
                  Take New Screenshot
                </Button>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                ></path>
              </svg>
              <p className="mt-2 text-sm text-gray-500">No screenshot available</p>
              {selectedViewer.status === 'running' && (
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-3"
                  onClick={handleTakeScreenshot}
                >
                  Take Screenshot
                </Button>
              )}
            </div>
          )}
        </Card>
        
        {/* Resource Monitor */}
        {selectedViewer.status === 'running' && (
          <ResourceMonitor viewerId={selectedViewer._id} />
        )}
      </div>
      
      {/* Logs */}
      <Card title="Logs" className="md:col-span-2">
        {isLoadingLogs ? (
          <div className="flex justify-center items-center py-8">
            <Spinner size="md" />
          </div>
        ) : viewerLogs && viewerLogs.length > 0 ? (
          <div className="overflow-auto max-h-96">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Time
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Level
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Message
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {viewerLogs.map((log, index) => (
                  <tr key={index}>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-500">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-500">
                      {log.level || 'info'}
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-500">
                      {log.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-6 text-gray-500">
            No logs available
          </div>
        )}
      </Card>
    </div>
  );
};

const ResourceMonitor = ({ viewerId }) => {
  const { viewerResources, fetchViewerResources, updateViewerResourceLimits } = useAppContext();
  const [isEditingLimits, setIsEditingLimits] = useState(false);
  const [limits, setLimits] = useState({
    cpuLimit: 100,
    memoryLimit: 500,
    networkLimit: 5
  });
  
  const resources = viewerResources[viewerId] || {
    cpu: 0,
    memory: 0,
    networkRx: 0,
    networkTx: 0,
    lastUpdated: null,
    resourceLimits: {
      cpuLimit: 100,
      memoryLimit: 500,
      networkLimit: 5
    }
  };
  
  useEffect(() => {
    // Initial fetch
    fetchViewerResources(viewerId).catch(err => 
      console.error(`Error fetching viewer resources: ${err.message}`)
    );
    
    // Set up polling interval (every 5 seconds)
    const interval = setInterval(() => {
      fetchViewerResources(viewerId).catch(err => 
        console.error(`Error fetching viewer resources in interval: ${err.message}`)
      );
    }, 5000);
    
    return () => clearInterval(interval);
  }, [viewerId, fetchViewerResources]);
  
  // Update limits from resources when available
  useEffect(() => {
    if (resources && resources.resourceLimits) {
      setLimits({
        cpuLimit: resources.resourceLimits.cpuLimit || 100,
        memoryLimit: resources.resourceLimits.memoryLimit || 500,
        networkLimit: resources.resourceLimits.networkLimit || 5
      });
    }
  }, [resources]);
  
  const handleLimitChange = (e) => {
    const { name, value } = e.target;
    setLimits(prev => ({
      ...prev,
      [name]: Number(value)
    }));
  };
  
  const handleSaveLimits = async () => {
    try {
      await updateViewerResourceLimits(viewerId, limits);
      setIsEditingLimits(false);
    } catch (error) {
      console.error('Error saving resource limits:', error);
    }
  };
  
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  };
  
  if (!resources) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 mt-4">
        <h3 className="text-xl font-semibold mb-4">Resource Monitor</h3>
        <div className="text-gray-400">Loading resource data...</div>
      </div>
    );
  }
  
  return (
    <div className="bg-gray-800 rounded-lg p-4 mt-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">Resource Monitor</h3>
        <div className="flex space-x-2">
          <button
            onClick={() => fetchViewerResources(viewerId)}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-md text-sm"
            title="Refresh resource data"
          >
            <i className="fas fa-sync-alt"></i>
          </button>
          {isEditingLimits ? (
            <button
              onClick={handleSaveLimits}
              className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded-md text-sm"
            >
              Save Limits
            </button>
          ) : (
            <button
              onClick={() => setIsEditingLimits(true)}
              className="px-3 py-1 bg-gray-600 hover:bg-gray-700 rounded-md text-sm"
            >
              Edit Limits
            </button>
          )}
        </div>
      </div>
      
      <div className="text-sm text-gray-400 mb-2">
        Last updated: {formatTimestamp(resources.lastUpdated)}
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* CPU Usage */}
        <div className="bg-gray-700 p-3 rounded-md">
          <div className="flex justify-between mb-1">
            <span>CPU Usage</span>
            <span>{resources.cpu}%</span>
          </div>
          <div className="w-full bg-gray-600 rounded-full h-2.5">
            <div 
              className={`h-2.5 rounded-full ${
                resources.cpu > 80 ? 'bg-red-600' : 
                resources.cpu > 60 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(resources.cpu, 100)}%` }}
            ></div>
          </div>
          {isEditingLimits && (
            <div className="mt-2">
              <label className="text-xs text-gray-400">CPU Limit (%)</label>
              <input
                type="number"
                name="cpuLimit"
                value={limits.cpuLimit}
                onChange={handleLimitChange}
                min="1"
                max="100"
                className="w-full bg-gray-800 text-white border border-gray-600 rounded p-1 text-sm"
              />
            </div>
          )}
        </div>
        
        {/* Memory Usage */}
        <div className="bg-gray-700 p-3 rounded-md">
          <div className="flex justify-between mb-1">
            <span>Memory Usage</span>
            <span>{resources.memory} MB</span>
          </div>
          <div className="w-full bg-gray-600 rounded-full h-2.5">
            <div 
              className={`h-2.5 rounded-full ${
                resources.memory > limits.memoryLimit * 0.8 ? 'bg-red-600' : 
                resources.memory > limits.memoryLimit * 0.6 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min((resources.memory / limits.memoryLimit) * 100, 100)}%` }}
            ></div>
          </div>
          {isEditingLimits && (
            <div className="mt-2">
              <label className="text-xs text-gray-400">Memory Limit (MB)</label>
              <input
                type="number"
                name="memoryLimit"
                value={limits.memoryLimit}
                onChange={handleLimitChange}
                min="100"
                className="w-full bg-gray-800 text-white border border-gray-600 rounded p-1 text-sm"
              />
            </div>
          )}
        </div>
        
        {/* Network Usage */}
        <div className="bg-gray-700 p-3 rounded-md">
          <div className="flex justify-between mb-1">
            <span>Network Download</span>
            <span>{resources.networkRx.toFixed(2)} Mbps</span>
          </div>
          <div className="w-full bg-gray-600 rounded-full h-2.5">
            <div 
              className="h-2.5 rounded-full bg-blue-500"
              style={{ width: `${Math.min((resources.networkRx / limits.networkLimit) * 100, 100)}%` }}
            ></div>
          </div>
        </div>
        
        {/* Network Upload */}
        <div className="bg-gray-700 p-3 rounded-md">
          <div className="flex justify-between mb-1">
            <span>Network Upload</span>
            <span>{resources.networkTx.toFixed(2)} Mbps</span>
          </div>
          <div className="w-full bg-gray-600 rounded-full h-2.5">
            <div 
              className="h-2.5 rounded-full bg-purple-500"
              style={{ width: `${Math.min((resources.networkTx / limits.networkLimit) * 100, 100)}%` }}
            ></div>
          </div>
          
          {isEditingLimits && (
            <div className="mt-2">
              <label className="text-xs text-gray-400">Network Limit (Mbps)</label>
              <input
                type="number"
                name="networkLimit"
                value={limits.networkLimit}
                onChange={handleLimitChange}
                min="1"
                className="w-full bg-gray-800 text-white border border-gray-600 rounded p-1 text-sm"
              />
            </div>
          )}
        </div>
      </div>
      
      {/* Resource Status and Messages */}
      {(resources.cpu > limits.cpuLimit || 
        resources.memory > limits.memoryLimit || 
        (resources.networkRx + resources.networkTx) > limits.networkLimit) && (
        <div className="bg-red-900/30 border border-red-800 text-red-200 p-3 rounded-md mt-2">
          <p className="font-semibold">⚠️ Resource limits exceeded</p>
          <p className="text-sm mt-1">
            One or more resource limits are currently being exceeded. The system may automatically
            restart the viewer if resource usage remains high.
          </p>
        </div>
      )}
    </div>
  );
};

export default ViewerDetail;
 