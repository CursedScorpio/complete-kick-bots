// src/components/UI/StatusBadge.jsx
import React from 'react';
import Badge from './Badge';

const StatusBadge = ({ status }) => {
  // Define variant based on status
  let variant;
  switch (status) {
    case 'running':
      variant = 'success';
      break;
    case 'starting':
      variant = 'info';
      break;
    case 'stopping':
      variant = 'warning';
      break;
    case 'error':
      variant = 'danger';
      break;
    case 'idle':
    default:
      variant = 'secondary';
      break;
  }
  
  // Format the status text
  const formatStatus = (status) => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };
  
  return <Badge variant={variant}>{formatStatus(status)}</Badge>;
};

export default StatusBadge;