// services/streamService.js
const Stream = require('../models/Stream');
const logger = require('../utils/logger');

// Get all streams
exports.getAllStreams = async () => {
  try {
    return await Stream.find().populate('activeViewers', 'name status box');
  } catch (error) {
    logger.error(`Error getting streams: ${error.message}`);
    throw new Error(`Failed to get streams: ${error.message}`);
  }
};

// Get stream by URL
exports.getStreamByUrl = async (url) => {
  try {
    const stream = await Stream.findOne({ url }).populate('activeViewers', 'name status box');
    return stream;
  } catch (error) {
    logger.error(`Error getting stream: ${error.message}`);
    throw new Error(`Failed to get stream: ${error.message}`);
  }
};

// Get stream chat messages
exports.getStreamChatMessages = async (url, limit = 100) => {
  try {
    const stream = await Stream.findOne({ url });
    
    if (!stream) {
      logger.warn(`Stream not found for URL: ${url} when getting chat messages`);
      return [];
    }
    
    // Get the most recent messages up to the limit
    return stream.chatMessages.slice(-limit);
  } catch (error) {
    logger.error(`Error getting stream chat: ${error.message}`);
    throw new Error(`Failed to get stream chat: ${error.message}`);
  }
};

// Update stream metadata
exports.updateStreamMetadata = async (url, metadata) => {
  try {
    let stream = await Stream.findOne({ url });
    
    if (!stream) {
      logger.info(`Stream not found for URL: ${url}, creating new stream record`);
      stream = new Stream({
        url,
        streamer: url.split('/').pop(),
        activeViewers: [],
        chatMessages: []
      });
    }
    
    // Update metadata fields
    if (metadata.title) stream.title = metadata.title;
    if (metadata.game) stream.game = metadata.game;
    if (metadata.viewers !== undefined) stream.viewers = metadata.viewers;
    if (metadata.isLive !== undefined) stream.isLive = metadata.isLive;
    if (metadata.startedAt) stream.startedAt = metadata.startedAt;
    
    await stream.save();
    
    return stream;
  } catch (error) {
    logger.error(`Error updating stream metadata: ${error.message}`);
    throw new Error(`Failed to update stream metadata: ${error.message}`);
  }
};