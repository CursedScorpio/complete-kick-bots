// src/pages/Boxes.jsx
import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BoxList from '../components/Box/BoxList';
import BoxDetail from '../components/Box/BoxDetail';

const Boxes = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const queryParams = new URLSearchParams(location.search);
  const boxId = queryParams.get('id');
  
  // If a box ID is provided, show the detail view
  const showDetail = !!boxId;
  
  return (
    <div>
      {showDetail ? (
        <BoxDetail boxId={boxId} />
      ) : (
        <BoxList />
      )}
    </div>
  );
};

export default Boxes;