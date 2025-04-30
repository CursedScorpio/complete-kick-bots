// src/components/Dashboard/ChatMonitor.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../../context/AppContext';
import api from '../../services/api';
import Card from '../UI/Card';
import Spinner from '../UI/Spinner';

const ChatMonitor = () => {
  const { viewers } = useAppContext();
  const [chatMessages, setChatMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedStream, setSelectedStream] = useState('');
  const [pollTimeout, setPollTimeout] = useState(null);
  const chatContainerRef = useRef(null);

  // Get unique streams from viewers with chat parsing enabled
  const chatParsers = viewers.filter(
    viewer => viewer.status === 'running' && viewer.isParseChatEnabled && viewer.streamUrl
  );
  
  const uniqueStreams = Array.from(
    new Set(chatParsers.map(viewer => viewer.streamUrl))
  ).map(url => {
    const viewer = chatParsers.find(v => v.streamUrl === url);
    return {
      url,
      streamer: viewer.streamer || url.split('/').pop(),
    };
  });

  // Fetch chat messages for the selected stream
  const fetchChatMessages = async () => {
    if (!selectedStream) {
      if (uniqueStreams.length > 0) {
        setSelectedStream(uniqueStreams[0].url);
        return; // Will trigger another effect run with the selectedStream set
      } else {
        setIsLoading(false);
        return;
      }
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Call the API endpoint with proper URL encoding
      const response = await api.get(`/api/streams/chat?url=${encodeURIComponent(selectedStream)}`);
      setChatMessages(response.data);
    } catch (err) {
      console.error('Failed to fetch chat messages:', err);
      setError('Failed to load chat messages');
    } finally {
      setIsLoading(false);
    }
  };

  // Effect to handle stream selection changes
  useEffect(() => {
    // Clear any existing poll
    if (pollTimeout) {
      clearTimeout(pollTimeout);
    }
    
    // Fetch immediately when selection changes
    fetchChatMessages();
    
    // Don't start polling if no stream is selected
    if (!selectedStream) return;
    
    // Set up polling for chat messages with a longer interval (30 seconds)
    const startPolling = () => {
      const timeoutId = setTimeout(() => {
        fetchChatMessages();
        // Schedule next poll only after current one completes
        startPolling();
      }, 30000); // 30 seconds interval
      
      setPollTimeout(timeoutId);
    };
    
    startPolling();
    
    // Cleanup
    return () => {
      if (pollTimeout) {
        clearTimeout(pollTimeout);
      }
    };
  }, [selectedStream, uniqueStreams.length]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Handle stream selection change
  const handleStreamChange = (e) => {
    setSelectedStream(e.target.value);
  };

  return (
    <Card title="Chat Monitor">
      {uniqueStreams.length > 0 ? (
        <>
          <div className="mb-4">
            <label htmlFor="stream-select" className="block text-sm font-medium text-gray-700">
              Select Stream
            </label>
            <select
              id="stream-select"
              value={selectedStream}
              onChange={handleStreamChange}
              className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm rounded-md"
            >
              {uniqueStreams.map((stream) => (
                <option key={stream.url} value={stream.url}>
                  {stream.streamer}
                </option>
              ))}
            </select>
          </div>
          
          <div 
            ref={chatContainerRef}
            className="overflow-y-auto h-80 border border-gray-200 rounded-md bg-gray-50"
          >
            {isLoading ? (
              <div className="flex justify-center items-center h-full">
                <Spinner size="md" />
              </div>
            ) : error ? (
              <div className="text-center py-8 text-danger-600">{error}</div>
            ) : chatMessages.length > 0 ? (
              <div className="p-3 space-y-3">
                {chatMessages.map((msg, index) => (
                  <div key={index} className="bg-white p-3 rounded-md shadow-sm">
                    <div className="flex items-baseline">
                      <span className="font-medium text-primary-600">{msg.username}</span>
                      <span className="ml-2 text-xs text-gray-500">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{msg.message}</p>
                    {msg.emotes && msg.emotes.length > 0 && (
                      <div className="mt-1 flex space-x-1">
                        {msg.emotes.map((emote, i) => (
                          <img
                            key={i}
                            src={emote.src}
                            alt={emote.name}
                            title={emote.name}
                            className="h-6 w-6"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No chat messages yet.
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <p>No active chat parsers available.</p>
          <p className="text-sm mt-2">
            Start a box with chat parsers to monitor streams.
          </p>
        </div>
      )}
    </Card>
  );
};

export default ChatMonitor;