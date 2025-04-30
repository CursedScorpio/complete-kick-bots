// src/components/Viewer/ViewerList.jsx
import React from 'react';
import { useAppContext } from '../../context/AppContext';
import ViewerCard from './ViewerCard';
import Button from '../UI/Button';
import Spinner from '../UI/Spinner';

const ViewerList = () => {
  const { viewers, viewersLoading, viewersError, fetchViewers } = useAppContext();
  
  // Filter viewers by status for grouping
  const activeViewers = viewers.filter(viewer => ['running', 'starting'].includes(viewer.status));
  const inactiveViewers = viewers.filter(viewer => !['running', 'starting'].includes(viewer.status));
  
  const handleRefresh = () => {
    fetchViewers();
  };
  
  if (viewersLoading && viewers.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }
  
  if (viewersError && viewers.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-danger-600 text-lg mb-4">
          Failed to load viewers: {viewersError}
        </div>
        <Button variant="primary" onClick={handleRefresh}>
          Try Again
        </Button>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">
          Viewers
          {viewersLoading && <Spinner size="sm" className="ml-2 inline-block" />}
        </h2>
        
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
        </div>
      </div>
      
      {/* Active Viewers */}
      {activeViewers.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">Active Viewers</h3>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {activeViewers.map((viewer) => (
              <ViewerCard key={viewer._id} viewer={viewer} />
            ))}
          </div>
        </div>
      )}
      
      {/* Inactive Viewers */}
      {inactiveViewers.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">Inactive Viewers</h3>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {inactiveViewers.map((viewer) => (
              <ViewerCard key={viewer._id} viewer={viewer} />
            ))}
          </div>
        </div>
      )}
      
      {/* No Viewers Message */}
      {viewers.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow">
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
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            ></path>
          </svg>
          <h3 className="mt-2 text-lg font-medium text-gray-900">No viewers available</h3>
          <p className="mt-1 text-sm text-gray-500">Start a box to create viewers.</p>
          <div className="mt-6">
            <Button
              variant="primary"
              onClick={() => window.location.href = '/boxes'}
            >
              Go to Boxes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ViewerList;