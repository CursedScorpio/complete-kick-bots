// src/components/Viewer/ViewerCard.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import Card from '../UI/Card';
import Button from '../UI/Button';
import StatusBadge from '../UI/StatusBadge';

const ViewerCard = ({ viewer }) => {
  const { stopViewer, updateViewer, setSelectedViewer } = useAppContext();
  const [streamUrl, setStreamUrl] = useState('');
  const [isStreamFormVisible, setIsStreamFormVisible] = useState(false);
  const navigate = useNavigate();
  
  const handleViewDetails = () => {
    setSelectedViewer(viewer);
    navigate(`/viewers?id=${viewer._id}`);
  };
  
  const handleStopViewer = async () => {
    try {
      await stopViewer(viewer._id);
    } catch (error) {
      console.error('Failed to stop viewer:', error);
    }
  };
  
  const handleStreamUrlChange = (e) => {
    setStreamUrl(e.target.value);
  };
  
  const handleSetStream = async (e) => {
    e.preventDefault();
    
    if (!streamUrl.trim()) return;
    
    try {
      await updateViewer(viewer._id, { streamUrl });
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
  
  // Render the card based on the viewer status
  const renderCardContent = () => {
    return (
      <>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900">{viewer.name}</h3>
            <p className="text-sm text-gray-500 mt-1">
              Box: {viewer.box?.name || 'Unknown'}
            </p>
          </div>
          <StatusBadge status={viewer.status} />
        </div>
        
        <div className="mt-4">
          {viewer.streamer ? (
            <div className="text-sm">
              <div className="font-medium">Stream:</div>
              <div className="text-primary-600 hover:text-primary-800 truncate">
                <a
                  href={viewer.streamUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {viewer.streamer}
                </a>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">No stream assigned</div>
          )}
          
          {viewer.isParseChatEnabled && (
            <div className="mt-2 text-xs text-success-600 bg-success-50 px-2 py-1 rounded inline-block">
              Chat Parser Enabled
            </div>
          )}
        </div>
        
        {viewer.error && (
          <div className="mt-3 text-sm text-danger-600 bg-danger-50 p-2 rounded-md">
            {viewer.error}
          </div>
        )}
        
        {/* Stream URL Form */}
        {isStreamFormVisible && (
          <div className="mt-4 p-3 border border-gray-200 rounded-md bg-gray-50">
            <form onSubmit={handleSetStream}>
              <div className="mb-2">
                <input
                  type="text"
                  value={streamUrl}
                  onChange={handleStreamUrlChange}
                  placeholder="https://kick.com/streamername"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                />
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
          
          {!isStreamFormVisible && viewer.status === 'running' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsStreamFormVisible(true)}
            >
              Set Stream
            </Button>
          )}
          
          {(viewer.status === 'running' || viewer.status === 'starting') && (
            <Button
              variant="warning"
              size="sm"
              onClick={handleStopViewer}
            >
              Stop
            </Button>
          )}
        </div>
      </>
    );
  };
  
  return (
    <Card className="h-full">
      {renderCardContent()}
    </Card>
  );
};

export default ViewerCard;