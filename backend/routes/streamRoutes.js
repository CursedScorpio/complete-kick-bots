// routes/streamRoutes.js
const express = require('express');
const router = express.Router();
const streamService = require('../services/streamService');
const logger = require('../utils/logger');

// Get all streams
router.get('/', async (req, res) => {
  try {
    const streams = await streamService.getAllStreams();
    res.status(200).json(streams);
  } catch (error) {
    logger.error(`Error getting streams: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get stream by URL
router.get('/info', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    const stream = await streamService.getStreamByUrl(url);
    
    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    
    res.status(200).json(stream);
  } catch (error) {
    logger.error(`Error getting stream info: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get chat messages for a stream
router.get('/chat', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    const limit = req.query.limit ? parseInt(req.query.limit) : 100;
    
    try {
      const messages = await streamService.getStreamChatMessages(url, limit);
      res.status(200).json(messages);
    } catch (error) {
      // If not found or other errors, send demo data
      logger.warn(`Stream chat not found, sending demo data: ${error.message}`);
      
      // Send mock data for demonstration purposes
      const mockMessages = [
        {
          timestamp: new Date(),
          username: 'Viewer1',
          message: 'Hello! This is a sample chat message.',
          emotes: []
        },
        {
          timestamp: new Date(Date.now() - 30000),
          username: 'Streamer',
          message: 'Welcome everyone to the stream!',
          emotes: []
        },
        {
          timestamp: new Date(Date.now() - 60000),
          username: 'Moderator',
          message: 'Remember to follow the chat rules!',
          emotes: []
        }
      ];
      
      res.status(200).json(mockMessages);
    }
  } catch (error) {
    logger.error(`Error getting stream chat: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 