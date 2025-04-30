// src/components/Box/BoxCard.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import Card from '../UI/Card';
import Button from '../UI/Button';
import StatusBadge from '../UI/StatusBadge';
import BoxForm from './BoxForm';

const BoxCard = ({ box }) => {
  const { startBox, stopBox, deleteBox, setSelectedBox, boxResources } = useAppContext();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const navigate = useNavigate();
  
  // Determine the active viewers count
  const activeViewersCount = box.viewers?.filter(v => v.status === 'running').length || 0;
  
  // Get resources for this box
  const resources = boxResources[box._id];
  
  const getResourceStatusColor = () => {
    if (!resources) return 'bg-gray-600';
    
    // Check if any resource is above 80% of its limit
    if (resources.cpu > 80 || 
        (resources.memory / 1024) > 0.8 || 
        (resources.networkRx + resources.networkTx) > 16) {
      return 'bg-red-600';
    }
    
    // Check if any resource is above 60% of its limit
    if (resources.cpu > 60 || 
        (resources.memory / 1024) > 0.6 || 
        (resources.networkRx + resources.networkTx) > 12) {
      return 'bg-yellow-500';
    }
    
    // Otherwise good
    return 'bg-green-500';
  };
  
  const handleViewDetails = () => {
    setSelectedBox(box);
    navigate(`/boxes?id=${box._id}`);
  };
  
  const handleStartBox = async () => {
    try {
      await startBox(box._id);
    } catch (error) {
      console.error('Failed to start box:', error);
    }
  };
  
  const handleStopBox = async () => {
    try {
      await stopBox(box._id);
    } catch (error) {
      console.error('Failed to stop box:', error);
    }
  };
  
  const handleDeleteConfirm = async () => {
    try {
      await deleteBox(box._id);
      setIsConfirmDeleteOpen(false);
    } catch (error) {
      console.error('Failed to delete box:', error);
    }
  };
  
  // Render the card based on the box status
  const renderCardContent = () => {
    // Determine if the box can be deleted (not running or starting, or is in error state)
    const canDelete = !['running', 'starting'].includes(box.status) || box.status === 'error';
    
    return (
      <>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900">{box.name}</h3>
            <p className="text-sm text-gray-500 mt-1">
              VPN: {box.vpnConfig || 'None'}
            </p>
          </div>
          <StatusBadge status={box.status} />
        </div>
        
        <div className="mt-4 flex items-center text-sm">
          <div className="flex-1">
            <div className="flex items-center">
              <svg className="w-4 h-4 text-gray-500 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
              </svg>
              <span>
                <span className="font-medium">{activeViewersCount}</span>
                <span className="text-gray-500"> / {box.viewers?.length || 0} viewers</span>
              </span>
            </div>
            
            {box.streamUrl && (
              <div className="flex items-center mt-1">
                <svg className="w-4 h-4 text-gray-500 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <a
                  href={box.streamUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:underline"
                >
                  {box.streamUrl.split('/').pop()}
                </a>
              </div>
            )}
            
            {box.ipAddress && (
              <div className="flex items-center mt-1">
                <svg className="w-4 h-4 text-gray-500 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path>
                </svg>
                <span className="text-gray-600">{box.ipAddress}</span>
              </div>
            )}
            
            {box.location && (
              <div className="flex items-center mt-1">
                <svg className="w-4 h-4 text-gray-500 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                </svg>
                <span className="text-gray-600">{box.location}</span>
              </div>
            )}
            
            {/* Add resource indicator for running boxes */}
            {box.status === 'running' && resources && (
              <div className="flex items-center ml-3">
                <div className={`w-2 h-2 rounded-full ${getResourceStatusColor()}`}></div>
                <span className="ml-1 text-xs text-gray-400">
                  {resources ? `${Math.round(resources.cpu)}% CPU` : 'Resources'}
                </span>
              </div>
            )}
          </div>
        </div>
        
        {box.error && (
          <div className="mt-3 text-sm text-danger-600 bg-danger-50 p-2 rounded-md">
            {box.error}
          </div>
        )}
        
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleViewDetails}
          >
            Details
          </Button>
          
          {box.status === 'idle' && (
            <>
              <Button
                variant="primary"
                size="sm"
                onClick={handleStartBox}
              >
                Start
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
          
          {canDelete && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setIsConfirmDeleteOpen(true)}
            >
              Delete
            </Button>
          )}
          
          {(box.status === 'running' || box.status === 'starting') && (
            <Button
              variant="warning"
              size="sm"
              onClick={handleStopBox}
            >
              Stop
            </Button>
          )}
          
          {box.status === 'error' && (
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
      </>
    );
  };
  
  return (
    <>
      <Card className="h-full">
        {renderCardContent()}
      </Card>
      
      {/* Edit Box Modal */}
      <BoxForm
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        box={box}
        isEdit
      />
      
      {/* Confirm Delete Modal */}
      {isConfirmDeleteOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Delete Box</h3>
              <p className="text-gray-600">
                Are you sure you want to delete "{box.name}"? This action cannot be undone.
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

export default BoxCard;