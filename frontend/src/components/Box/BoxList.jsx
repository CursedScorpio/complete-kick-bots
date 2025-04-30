// src/components/Box/BoxList.jsx
import React, { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import BoxCard from './BoxCard';
import Button from '../UI/Button';
import Spinner from '../UI/Spinner';
import BoxForm from './BoxForm';

const BoxList = () => {
  const { boxes, boxesLoading, boxesError, fetchBoxes } = useAppContext();
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Filter boxes by status for grouping
  const activeBoxes = boxes.filter(box => ['running', 'starting'].includes(box.status));
  const inactiveBoxes = boxes.filter(box => !['running', 'starting'].includes(box.status));
  
  const handleRefresh = () => {
    fetchBoxes();
  };
  
  if (boxesLoading && boxes.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }
  
  if (boxesError && boxes.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-danger-600 text-lg mb-4">
          Failed to load boxes: {boxesError}
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
          Boxes
          {boxesLoading && <Spinner size="sm" className="ml-2 inline-block" />}
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
          
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsModalOpen(true)}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
              </svg>
            }
          >
            Add Box
          </Button>
        </div>
      </div>
      
      {/* Active Boxes */}
      {activeBoxes.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">Active Boxes</h3>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {activeBoxes.map((box) => (
              <BoxCard key={box._id} box={box} />
            ))}
          </div>
        </div>
      )}
      
      {/* Inactive Boxes */}
      {inactiveBoxes.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">Inactive Boxes</h3>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {inactiveBoxes.map((box) => (
              <BoxCard key={box._id} box={box} />
            ))}
          </div>
        </div>
      )}
      
      {/* No Boxes Message */}
      {boxes.length === 0 && (
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
              d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2H5z"
            ></path>
          </svg>
          <h3 className="mt-2 text-lg font-medium text-gray-900">No boxes yet</h3>
          <p className="mt-1 text-sm text-gray-500">Get started by creating a new box.</p>
          <div className="mt-6">
            <Button
              variant="primary"
              onClick={() => setIsModalOpen(true)}
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                </svg>
              }
            >
              Add Box
            </Button>
          </div>
        </div>
      )}
      
      {/* Create Box Modal */}
      <BoxForm
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
};

export default BoxList;