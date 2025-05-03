import React, { useState, useEffect } from 'react';
import systemService from '../../services/systemService';
import Card from '../UI/Card';
import Button from '../UI/Button';
import Spinner from '../UI/Spinner';

const SystemResources = () => {
  const [metrics, setMetrics] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stopPolling, setStopPolling] = useState(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [resourceConfig, setResourceConfig] = useState({
    checkInterval: '',
    idleTimeout: '',
    memoryThresholdMB: '',
    maxViewerMemoryMB: '',
    gcAfterStoppedViewers: '',
    debug: false
  });
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [configError, setConfigError] = useState(null);

  // Load metrics on mount
  useEffect(() => {
    // Start polling metrics
    const stopPollingFn = systemService.pollSystemMetrics((err, data) => {
      setIsLoading(false);
      
      if (err) {
        setError(err.message || 'Failed to load system metrics');
      } else {
        setMetrics(data);
        setError(null);
      }
    }, 10000); // Update every 10 seconds
    
    setStopPolling(() => stopPollingFn);
    
    // Cleanup on unmount
    return () => {
      if (stopPollingFn) {
        stopPollingFn();
      }
    };
  }, []);
  
  // Handle resource check button
  const handleResourceCheck = async () => {
    try {
      await systemService.triggerResourceCheck();
      // No need to refresh metrics as polling will update it
    } catch (error) {
      setError(error.message || 'Failed to trigger resource check');
    }
  };
  
  // Handle stop idle viewers button
  const handleStopIdleViewers = async (force = false) => {
    try {
      await systemService.triggerStopIdleViewers(force);
      // No need to refresh metrics as polling will update it
    } catch (error) {
      setError(error.message || 'Failed to stop idle viewers');
    }
  };
  
  // Open config modal
  const openConfigModal = () => {
    // Populate form with current values if available
    if (metrics?.resourceManager) {
      // Convert ms to seconds for UI
      setResourceConfig({
        checkInterval: metrics.resourceManager.checkInterval ? (metrics.resourceManager.checkInterval / 1000).toString() : '',
        idleTimeout: metrics.resourceManager.idleTimeout ? (metrics.resourceManager.idleTimeout / 1000 / 60).toString() : '', // Convert to minutes
        memoryThresholdMB: metrics.resourceManager.memoryThresholdMB?.toString() || '',
        maxViewerMemoryMB: metrics.resourceManager.maxViewerMemoryMB?.toString() || '',
        gcAfterStoppedViewers: metrics.resourceManager.gcAfterStoppedViewers?.toString() || '',
        debug: !!metrics.resourceManager.debug
      });
    }
    
    setShowConfigModal(true);
  };
  
  // Handle resource config form change
  const handleConfigChange = (e) => {
    const { name, value, type, checked } = e.target;
    setResourceConfig({
      ...resourceConfig,
      [name]: type === 'checkbox' ? checked : value
    });
  };
  
  // Handle resource config form submit
  const handleConfigSubmit = async (e) => {
    e.preventDefault();
    setIsConfigLoading(true);
    setConfigError(null);
    
    try {
      // Convert seconds back to ms, minutes back to ms
      const config = {
        ...(resourceConfig.checkInterval && { checkInterval: parseInt(resourceConfig.checkInterval, 10) * 1000 }),
        ...(resourceConfig.idleTimeout && { idleTimeout: parseInt(resourceConfig.idleTimeout, 10) * 60 * 1000 }),
        ...(resourceConfig.memoryThresholdMB && { memoryThresholdMB: parseInt(resourceConfig.memoryThresholdMB, 10) }),
        ...(resourceConfig.maxViewerMemoryMB && { maxViewerMemoryMB: parseInt(resourceConfig.maxViewerMemoryMB, 10) }),
        ...(resourceConfig.gcAfterStoppedViewers && { gcAfterStoppedViewers: parseInt(resourceConfig.gcAfterStoppedViewers, 10) }),
        debug: resourceConfig.debug
      };
      
      await systemService.updateResourceManagerConfig(config);
      setShowConfigModal(false);
    } catch (error) {
      setConfigError(error.message || 'Failed to update resource configuration');
    } finally {
      setIsConfigLoading(false);
    }
  };
  
  if (isLoading) {
    return (
      <Card title="System Resources">
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      </Card>
    );
  }
  
  return (
    <>
      <Card title="System Resources" 
          actions={
            <div className="flex space-x-2">
              <Button
                size="sm"
                variant="primary"
                onClick={openConfigModal}
              >
                Configure
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleResourceCheck}
              >
                Check Now
              </Button>
            </div>
          }
      >
        {error && (
          <div className="p-3 mb-4 text-sm text-danger-700 bg-danger-100 rounded-md">
            {error}
          </div>
        )}
        
        {metrics && (
          <div className="space-y-6">
            {/* System Resource Stats */}
            <div>
              <h3 className="text-lg font-semibold mb-2">System Resources</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-sm text-gray-500">Memory Used</div>
                  <div className="font-semibold">{metrics.system.memory.used} MB</div>
                  <div className="text-xs text-gray-400">of {metrics.system.memory.total} MB</div>
                </div>
                
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-sm text-gray-500">Process Memory</div>
                  <div className="font-semibold">{metrics.system.memory.processRSS} MB</div>
                  <div className="text-xs text-gray-400">Heap: {metrics.system.memory.processHeapUsed} MB</div>
                </div>
                
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-sm text-gray-500">Load Average</div>
                  <div className="font-semibold">{metrics.system.loadAvg[0].toFixed(2)}</div>
                  <div className="text-xs text-gray-400">5m: {metrics.system.loadAvg[1].toFixed(2)}, 15m: {metrics.system.loadAvg[2].toFixed(2)}</div>
                </div>
                
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-sm text-gray-500">Uptime</div>
                  <div className="font-semibold">
                    {Math.floor(metrics.system.uptime / 3600)}h {Math.floor((metrics.system.uptime % 3600) / 60)}m
                  </div>
                  <div className="text-xs text-gray-400">{new Date(metrics.timestamp).toLocaleString()}</div>
                </div>
              </div>
            </div>
            
            {/* Viewer Stats */}
            <div>
              <h3 className="text-lg font-semibold mb-2">Viewer Statistics</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-sm text-gray-500">Total Viewers</div>
                  <div className="font-semibold">{metrics.application.viewers.total}</div>
                </div>
                
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-sm text-gray-500">Running Viewers</div>
                  <div className="font-semibold">{metrics.application.viewers.running}</div>
                </div>
                
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-sm text-gray-500">Viewers Stopped</div>
                  <div className="font-semibold">
                    {metrics.resourceManager?.totalViewersStopped || 0}
                  </div>
                  <div className="text-xs text-gray-400">By Resource Manager</div>
                </div>
                
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-sm text-gray-500">Memory Recovered</div>
                  <div className="font-semibold">
                    {metrics.resourceManager?.totalMemoryRecovered || 0} MB
                  </div>
                </div>
              </div>
            </div>
            
            {/* Resource Manager Actions */}
            <div>
              <h3 className="text-lg font-semibold mb-2">Resource Management</h3>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => handleStopIdleViewers(false)}
                >
                  Stop Very Idle Viewers
                </Button>
                
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => handleStopIdleViewers(true)}
                >
                  Stop All Idle Viewers
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>
      
      {/* Configuration Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen p-4">
            <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowConfigModal(false)}></div>
            
            <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-4 border-b">
                <h3 className="text-lg font-semibold">Resource Manager Configuration</h3>
              </div>
              
              <form onSubmit={handleConfigSubmit}>
                <div className="p-4 space-y-4">
                  {configError && (
                    <div className="p-3 text-sm text-danger-700 bg-danger-100 rounded-md">
                      {configError}
                    </div>
                  )}
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Check Interval (seconds)
                    </label>
                    <input
                      type="number"
                      name="checkInterval"
                      value={resourceConfig.checkInterval}
                      onChange={handleConfigChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="300"
                      min="10"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      How often to check resource usage (min: 10s)
                    </p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Idle Timeout (minutes)
                    </label>
                    <input
                      type="number"
                      name="idleTimeout"
                      value={resourceConfig.idleTimeout}
                      onChange={handleConfigChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="240"
                      min="1"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      How long a viewer can be idle before being stopped (min: 1m)
                    </p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Memory Threshold (MB)
                    </label>
                    <input
                      type="number"
                      name="memoryThresholdMB"
                      value={resourceConfig.memoryThresholdMB}
                      onChange={handleConfigChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="2048"
                      min="100"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Memory threshold before cleanup is triggered (min: 100MB)
                    </p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Max Viewer Memory (MB)
                    </label>
                    <input
                      type="number"
                      name="maxViewerMemoryMB"
                      value={resourceConfig.maxViewerMemoryMB}
                      onChange={handleConfigChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="300"
                      min="50"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Maximum allowed memory per viewer (min: 50MB)
                    </p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      GC After Stopped Viewers
                    </label>
                    <input
                      type="number"
                      name="gcAfterStoppedViewers"
                      value={resourceConfig.gcAfterStoppedViewers}
                      onChange={handleConfigChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="3"
                      min="1"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Run garbage collection after this many viewers are stopped
                    </p>
                  </div>
                  
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="debug"
                      name="debug"
                      checked={resourceConfig.debug}
                      onChange={handleConfigChange}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <label htmlFor="debug" className="ml-2 block text-sm text-gray-700">
                      Enable Debug Logging
                    </label>
                  </div>
                </div>
                
                <div className="p-4 border-t flex justify-end space-x-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowConfigModal(false)}
                    disabled={isConfigLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={isConfigLoading}
                  >
                    Save Configuration
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SystemResources; 