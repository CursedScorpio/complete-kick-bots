
// src/components/Layout/Sidebar.jsx
import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';

const Sidebar = ({ mobile = false }) => {
  const { stats } = useAppContext();
  
  // Navigation items
  const navItems = [
    {
      name: 'Dashboard',
      path: '/dashboard',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h2a1 1 0 001-1v-7m-10 5h4"></path>
        </svg>
      ),
    },
    {
      name: 'Boxes',
      path: '/boxes',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2H5z"></path>
        </svg>
      ),
      count: stats.activeBoxes,
    },
    {
      name: 'Viewers',
      path: '/viewers',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
        </svg>
      ),
      count: stats.activeViewers,
    },
    {
      name: 'Settings',
      path: '/settings',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
        </svg>
      ),
    },
  ];

  return (
    <div className={`flex flex-col h-full bg-white border-r border-gray-200 ${mobile ? 'w-full' : ''}`}>
      {/* Logo */}
      <div className="flex items-center h-16 flex-shrink-0 px-4 bg-primary-700">
        <Link to="/" className="flex items-center">
          <svg className="h-8 w-8 text-white" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 0C6.268 0 0 6.268 0 14C0 21.732 6.268 28 14 28C21.732 28 28 21.732 28 14C28 6.268 21.732 0 14 0Z" fill="#53FC18"/>
            <path d="M17.5 8.75C17.5 8.06 16.94 7.5 16.25 7.5H11.75C11.06 7.5 10.5 8.06 10.5 8.75V19.25C10.5 19.94 11.06 20.5 11.75 20.5H16.25C16.94 20.5 17.5 19.94 17.5 19.25V8.75Z" fill="black"/>
            <path d="M21 11.75C21 11.06 20.44 10.5 19.75 10.5H18.375C17.685 10.5 17.125 11.06 17.125 11.75V16.25C17.125 16.94 17.685 17.5 18.375 17.5H19.75C20.44 17.5 21 16.94 21 16.25V11.75Z" fill="black"/>
            <path d="M10.875 11.75C10.875 11.06 10.315 10.5 9.625 10.5H8.25C7.56 10.5 7 11.06 7 11.75V16.25C7 16.94 7.56 17.5 8.25 17.5H9.625C10.315 17.5 10.875 16.94 10.875 16.25V11.75Z" fill="black"/>
          </svg>
          <span className="ml-2 text-white font-medium text-lg">Kick Viewer Bot</span>
        </Link>
      </div>
      
      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center px-2 py-2 text-sm font-medium rounded-md ${
                isActive
                  ? 'bg-primary-100 text-primary-900'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <div className="mr-3 flex-shrink-0">{item.icon}</div>
            <span>{item.name}</span>
            {item.count > 0 && (
              <span className="ml-auto inline-block py-0.5 px-2 text-xs rounded-full bg-primary-100 text-primary-800">
                {item.count}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      
      {/* Footer */}
      <div className="flex-shrink-0 border-t border-gray-200 p-4">
        <div className="text-xs text-gray-500">
          <div className="font-medium">Kick Viewer Simulator</div>
          <div>Version 1.0.0</div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;