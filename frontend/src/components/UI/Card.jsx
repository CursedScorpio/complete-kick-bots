// src/components/UI/Card.jsx
import React from 'react';

const Card = ({
  children,
  className = '',
  title = null,
  footer = null,
  noPadding = false,
}) => {
  return (
    <div className={`bg-white overflow-hidden shadow rounded-lg ${className}`}>
      {title && (
        <div className="border-b border-gray-200 px-4 py-3 bg-gray-50">
          <h3 className="text-lg leading-6 font-medium text-gray-900">{title}</h3>
        </div>
      )}
      
      <div className={`${noPadding ? '' : 'px-4 py-5 sm:p-6'}`}>
        {children}
      </div>
      
      {footer && (
        <div className="border-t border-gray-200 px-4 py-4 sm:px-6 bg-gray-50">
          {footer}
        </div>
      )}
    </div>
  );
};

export default Card;