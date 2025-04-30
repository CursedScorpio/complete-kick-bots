// src/components/Layout/Header.jsx
import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';

const Header = ({ setSidebarOpen }) => {
  const location = useLocation();
  const { stats } = useAppContext();
  
  // Get the current page title based on the URL path
  const getPageTitle = () => {
    const path = location.pathname;
    
    if (path === '/dashboard') return 'Dashboard';
    if (path === '/boxes') return 'Boxes';
    if (path === '/viewers') return 'Viewers';
    if (path === '/settings') return 'Settings';
    return 'Kick Viewer Simulator';
  };

  return (
    <header className="bg-white shadow-sm z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center lg:hidden">
              <button
                type="button"
                className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
                onClick={() => setSidebarOpen(true)}
              >
                <span className="sr-only">Open sidebar</span>
                <svg
                  className="h-6 w-6"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
            </div>
            
            <div className="hidden lg:flex lg:items-center lg:ml-6">
              <h1 className="text-2xl font-semibold text-gray-900">{getPageTitle()}</h1>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            {/* Quick stats */}
            <div className="hidden md:flex space-x-4">
              <div className="px-3 py-1 rounded-md bg-primary-100 text-primary-800">
                <span className="font-semibold">{stats.activeBoxes}</span>
                <span className="ml-1 text-xs">Boxes</span>
              </div>
              
              <div className="px-3 py-1 rounded-md bg-success-100 text-success-800">
                <span className="font-semibold">{stats.activeViewers}</span>
                <span className="ml-1 text-xs">Viewers</span>
              </div>
              
              {stats.errorBoxes > 0 && (
                <div className="px-3 py-1 rounded-md bg-danger-100 text-danger-800">
                  <span className="font-semibold">{stats.errorBoxes}</span>
                  <span className="ml-1 text-xs">Errors</span>
                </div>
              )}
            </div>
            
            {/* Profile dropdown could go here */}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;