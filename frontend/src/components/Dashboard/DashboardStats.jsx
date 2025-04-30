// src/components/Dashboard/DashboardStats.jsx
import React from 'react';
import { useAppContext } from '../../context/AppContext';
import Card from '../UI/Card';

const DashboardStats = () => {
  const { stats, boxesLoading, viewersLoading } = useAppContext();

  const statItems = [
    {
      name: 'Active Boxes',
      value: stats.activeBoxes,
      total: stats.totalBoxes,
      icon: (
        <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2H5z"></path>
        </svg>
      ),
      loading: boxesLoading,
    },
    {
      name: 'Active Viewers',
      value: stats.activeViewers,
      total: stats.totalViewers,
      icon: (
        <svg className="w-6 h-6 text-success-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
        </svg>
      ),
      loading: viewersLoading,
    },
  ];

  // Add error stats only if there are errors
  if (stats.errorBoxes > 0 || stats.errorViewers > 0) {
    statItems.push({
      name: 'Errors',
      value: stats.errorBoxes + stats.errorViewers,
      total: stats.totalBoxes + stats.totalViewers,
      icon: (
        <svg className="w-6 h-6 text-danger-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      ),
      loading: boxesLoading || viewersLoading,
    });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {statItems.map((item, index) => (
        <Card key={index} className="flex items-center p-6">
          <div className="p-3 rounded-full bg-opacity-10" style={{ backgroundColor: getComputedStyle(document.documentElement).getPropertyValue(`--color-${item.name.toLowerCase().replace(/\s+/g, '-')}`) }}>
            {item.icon}
          </div>
          <div className="ml-5">
            <p className="text-sm font-medium text-gray-500 truncate">{item.name}</p>
            <div className="flex items-baseline">
              <p className="text-2xl font-semibold text-gray-900">{item.value}</p>
              <p className="ml-2 text-sm font-medium text-gray-500">of {item.total}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default DashboardStats;