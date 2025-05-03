// src/pages/Dashboard.jsx
import React from 'react';
import DashboardStats from '../components/Dashboard/DashboardStats';
import StreamMonitor from '../components/Dashboard/StreamMonitor';
import ChatMonitor from '../components/Dashboard/ChatMonitor';
import SystemResources from '../components/Dashboard/SystemResources';

const Dashboard = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of your Kick Viewer Simulator activity
        </p>
      </div>
      
      {/* Stats Cards */}
      <DashboardStats />
      
      {/* System Resources */}
      <SystemResources />
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Stream Monitor */}
        <StreamMonitor />
        
        {/* Chat Monitor */}
        <ChatMonitor />
      </div>
    </div>
  );
};

export default Dashboard;