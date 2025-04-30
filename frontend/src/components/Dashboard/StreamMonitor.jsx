// src/components/Dashboard/StreamMonitor.jsx
import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import api from '../../services/api';
import Card from '../UI/Card';
import Spinner from '../UI/Spinner';
import { Link } from 'react-router-dom';

const StreamMonitor = () => {
  const { viewers } = useAppContext();
  const [streams, setStreams] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Group viewers by stream
  useEffect(() => {
    const activeViewers = viewers.filter(viewer => viewer.status === 'running');
    
    // Group viewers by stream URL
    const streamMap = new Map();
    activeViewers.forEach(viewer => {
      if (viewer.streamUrl) {
        if (!streamMap.has(viewer.streamUrl)) {
          streamMap.set(viewer.streamUrl, {
            url: viewer.streamUrl,
            streamer: viewer.streamer || viewer.streamUrl.split('/').pop(),
            title: viewer.streamMetadata?.title || '',
            game: viewer.streamMetadata?.game || '',
            viewers: [],
          });
        }
        streamMap.get(viewer.streamUrl).viewers.push(viewer);
      }
    });
    
    setStreams(Array.from(streamMap.values()));
    setIsLoading(false);
  }, [viewers]);

  if (isLoading) {
    return (
      <Card title="Active Streams">
        <div className="flex justify-center items-center py-8">
          <Spinner size="md" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Active Streams">
        <div className="text-center py-6">
          <div className="text-danger-600 mb-2">Error loading streams: {error}</div>
          <button
            className="text-primary-600 hover:text-primary-800"
            onClick={() => setIsLoading(true)}
          >
            Try Again
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Active Streams">
      {streams.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Streamer
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Title
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Game
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Viewers
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {streams.map((stream, index) => (
                <tr key={index}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <a
                      href={stream.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 hover:text-primary-900"
                    >
                      {stream.streamer}
                    </a>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 max-w-xs truncate">
                    {stream.title || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {stream.game || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div className="flex items-center">
                      <span className="font-medium">{stream.viewers.length}</span>
                      <Link
                        to="/viewers"
                        className="ml-2 text-xs text-primary-600 hover:text-primary-800"
                      >
                        View
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <p>No active streams at the moment.</p>
          <p className="text-sm mt-2">
            Start a box and set stream URLs to see streams here.
          </p>
        </div>
      )}
    </Card>
  );
};

export default StreamMonitor;
