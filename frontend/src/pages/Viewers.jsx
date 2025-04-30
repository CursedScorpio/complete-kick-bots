// src/pages/Viewers.jsx
import React from 'react';
import { useLocation } from 'react-router-dom';
import ViewerList from '../components/Viewer/ViewerList';
import ViewerDetail from '../components/Viewer/ViewerDetail';

const Viewers = () => {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const viewerId = queryParams.get('id');
  
  // If a viewer ID is provided, show the detail view
  const showDetail = !!viewerId;
  
  return (
    <div>
      {showDetail ? (
        <ViewerDetail viewerId={viewerId} />
      ) : (
        <ViewerList />
      )}
    </div>
  );
};

export default Viewers;