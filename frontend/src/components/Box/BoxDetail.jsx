// src/components/Box/BoxDetail.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import boxService from '../../services/boxService';
import Card from '../UI/Card';
import Button from '../UI/Button';
import StatusBadge from '../UI/StatusBadge';
import Spinner from '../UI/Spinner';
import BoxForm from './BoxForm';

const BoxDetail = ({ boxId }) => {
  const {
    selectedBox,
    setSelectedBox,
    startBox,
    stopBox,
    deleteBox,
    fetchBoxDetails,
  } = useAppContext();
  
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [stopPolling, setStopPolling] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [isRefreshingIp, setIsRefreshingIp] = useState(false);
  
  const navigate = useNavigate();
  
  // Fetch box details on mount
  useEffect(() => {
    const loadBoxDetails = async () => {
      setIsLoading(true);
      try {
        await fetchBoxDetails(boxId);
      } catch (error) {
        console.error('Failed to fetch box details:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    if (boxId) {
      loadBoxDetails();
    }
  }, [boxId, fetchBoxDetails]);
  
  // Start/stop polling based on box status
  useEffect(() => {
    if (
      selectedBox &&
      (selectedBox.status === 'starting' ||
        selectedBox.status === 'stopping' ||
        selectedBox.status === 'running')
    ) {
      if (!isPolling) {
        setIsPolling(true);
        
        const stopPollingFn = boxService.pollBoxStatus(
          selectedBox._id,
          (error, data) => {
            if (error) {
              console.error('Polling error:', error);
            } else if (data) {
              setSelectedBox(data);
            }
          },
          15000
        );
        
        setStopPolling(() => stopPollingFn);
      }
    } else if (isPolling && stopPolling) {
      stopPolling();
      setIsPolling(false);
      setStopPolling(null);
    }
    
    return () => {
      if (stopPolling) {
        stopPolling();
      }
    };
  }, [selectedBox, isPolling, stopPolling, setSelectedBox]);
  
  const handleBack = () => {
    navigate('/boxes');
  };
  
  const handleStartBox = async () => {
    try {
      await startBox(boxId);
    } catch (error) {
      console.error('Failed to start box:', error);
    }
  };
  
  const handleStopBox = async () => {
    try {
      await stopBox(boxId);
    } catch (error) {
      console.error('Failed to stop box:', error);
    }
  };
  
  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      await fetchBoxDetails(boxId);
    } catch (error) {
      console.error('Failed to refresh box details:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleRefreshIp = async () => {
    if (!selectedBox || selectedBox.status !== 'running' || isRefreshingIp) {
      return;
    }
    
    setIsRefreshingIp(true);
    try {
      const result = await boxService.refreshBoxIp(boxId);
      if (result && result.ipAddress) {
        // Update the box in the context with the new IP
        setSelectedBox({
          ...selectedBox,
          ipAddress: result.ipAddress,
          location: result.location
        });
      }
    } catch (error) {
      console.error('Failed to refresh IP:', error);
    } finally {
      setIsRefreshingIp(false);
    }
  };
  
  const handleDeleteConfirm = async () => {
    try {
      await deleteBox(boxId);
      setIsConfirmDeleteOpen(false);
      navigate('/boxes');
    } catch (error) {
      console.error('Failed to delete box:', error);
    }
  };
  
  // Determine if the box can be deleted (not running or starting, or is in error state)
  const canDelete = selectedBox && (!['running', 'starting'].includes(selectedBox.status) || selectedBox.status === 'error');
  
  // Loading state
  if (isLoading && !selectedBox) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }
  
  // Not found state
  if (!selectedBox) {
    return (
      <div className="text-center py-12">
        <div className="text-danger-600 text-lg mb-4">Box not found</div>
        <Button variant="primary" onClick={handleBack}>
          Back to Boxes
        </Button>
      </div>
    );
  }
  
  // Render counts
  const activeViewersCount = selectedBox.viewers?.filter(v => v.status === 'running').length || 0;
  const totalViewersCount = selectedBox.viewers?.length || 0;
  
  return (
    <>
      <div className="space-y-6">
        {/* Box Header */}
        <div className="flex justify-between items-center">
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="text-gray-600 hover:text-gray-900"
            >
              ← Back to Boxes
            </Button>
            <h2 className="mt-2 text-2xl font-bold text-gray-900">
              {selectedBox.name}
              <StatusBadge status={selectedBox.status} className="ml-3" />
            </h2>
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
            
            {selectedBox.status === 'idle' && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleStartBox}
                >
                  Start Box
                </Button>
                
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsEditModalOpen(true)}
                >
                  Edit Box
                </Button>
              </>
            )}
            
            {canDelete && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setIsConfirmDeleteOpen(true)}
              >
                Delete Box
              </Button>
            )}
            
            {(selectedBox.status === 'running' || selectedBox.status === 'starting') && (
              <Button
                variant="warning"
                size="sm"
                onClick={handleStopBox}
              >
                Stop Box
              </Button>
            )}
            
            {selectedBox.status === 'error' && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleStartBox}
                >
                  Retry
                </Button>
                
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsEditModalOpen(true)}
                >
                  Edit
                </Button>
              </>
            )}
          </div>
        </div>
        
        {/* Box Information */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Box Details */}
          <Card title="Box Details">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500">Status</label>
                <div className="mt-1">
                  <StatusBadge status={selectedBox.status} />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-500">VPN Configuration</label>
                <div className="mt-1 text-sm">{selectedBox.vpnConfig}</div>
              </div>
              
              {selectedBox.ipAddress && (
                <div>
                  <label className="block text-sm font-medium text-gray-500">IP Address</label>
                  <div className="mt-1 flex items-center">
                    <span className="text-sm mr-2">{selectedBox.ipAddress}</span>
                    {selectedBox.status === 'running' && (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={handleRefreshIp}
                        disabled={isRefreshingIp}
                      >
                        {isRefreshingIp ? 'Refreshing...' : 'Refresh IP'}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              
              {selectedBox.location && (
                <div>
                  <label className="block text-sm font-medium text-gray-500">Location</label>
                  <div className="mt-1 text-sm">{selectedBox.location}</div>
                </div>
              )}
              
              {selectedBox.streamUrl && (
                <div>
                  <label className="block text-sm font-medium text-gray-500">Stream URL</label>
                  <div className="mt-1 text-sm">
                    <a
                      href={selectedBox.streamUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 hover:underline"
                    >
                      {selectedBox.streamUrl.split('/').pop() || selectedBox.streamUrl}
                    </a>
                  </div>
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-500">Viewers</label>
                <div className="mt-1 text-sm">
                  <span className="font-medium">{activeViewersCount}</span>
                  <span className="text-gray-500"> active out of </span>
                  <span className="font-medium">{totalViewersCount}</span>
                  <span className="text-gray-500"> total</span>
                  <span className="text-gray-500"> (configured for </span>
                  <span className="font-medium">{selectedBox.viewersPerBox || 10}</span>
                  <span className="text-gray-500"> viewers)</span>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-500">Default Max Tabs</label>
                <div className="mt-1 text-sm">
                  <span className="font-medium">{selectedBox.defaultMaxTabs || 1}</span>
                  <span className="text-gray-500"> tabs per viewer</span>
                </div>
              </div>
              
              {selectedBox.error && (
                <div>
                  <label className="block text-sm font-medium text-danger-500">Error</label>
                  <div className="mt-1 text-sm text-danger-600 bg-danger-50 p-2 rounded-md">
                    {selectedBox.error}
                  </div>
                </div>
              )}
            </div>
          </Card>
          
          {/* Active Viewers */}
          <Card title="Viewers" className="md:col-span-2">
            {selectedBox.viewers && selectedBox.viewers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Viewer
                      </th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Stream
                      </th>
                      <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {selectedBox.viewers.map((viewer) => (
                      <tr key={viewer._id}>
                        <td className="px-3 py-2 whitespace-nowrap text-sm">
                          {viewer.name}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm">
                          <StatusBadge status={viewer.status} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm">
                          {viewer.streamer ? (
                            <a
                              href={viewer.streamUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary-600 hover:text-primary-900"
                            >
                              {viewer.streamer}
                            </a>
                          ) : (
                            <span className="text-gray-500">No stream</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              navigate(`/viewers?id=${viewer._id}`);
                            }}
                          >
                            Details
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-4 text-gray-500">
                No viewers available for this box.
              </div>
            )}
          </Card>
        </div>
      </div>
      
      {/* Edit Box Modal */}
      <BoxForm
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        box={selectedBox}
        isEdit
      />
      
      {/* Confirm Delete Modal */}
      {isConfirmDeleteOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Delete Box</h3>
              <p className="text-gray-600">
                Are you sure you want to delete "{selectedBox.name}"? This will also remove all associated viewers.
              </p>
              <div className="mt-6 flex justify-end space-x-3">
                <Button
                  variant="secondary"
                  onClick={() => setIsConfirmDeleteOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={handleDeleteConfirm}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BoxDetail;