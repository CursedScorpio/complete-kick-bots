// controllers/viewerController.js
const Viewer = require('../models/Viewer');
const Box = require('../models/Box');
const Stream = require('../models/Stream');
const puppeteerService = require('../services/puppeteerService');
const streamService = require('../services/streamService');
const logger = require('../utils/logger');
const config = require('../config/config');
const path = require('path');
const fs = require('fs');
const resourceMonitorService = require('../services/resourceMonitorService');

// Get all viewers
exports.getAllViewers = async (req, res) => {
  try {
    const viewers = await Viewer.find().populate('box', 'name status');
    res.status(200).json(viewers);
  } catch (error) {
    logger.error(`Error getting viewers: ${error.message}`);
    res.status(500).json({ message: 'Error retrieving viewers', error: error.message });
  }
};

// Get viewer by ID
exports.getViewerById = async (req, res) => {
  try {
    const viewer = await Viewer.findById(req.params.id).populate('box', 'name status ipAddress');
    
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    res.status(200).json(viewer);
  } catch (error) {
    logger.error(`Error getting viewer: ${error.message}`);
    res.status(500).json({ message: 'Error retrieving viewer', error: error.message });
  }
};

// Update a viewer
exports.updateViewer = async (req, res) => {
  try {
    const { streamUrl } = req.body;
    
    const viewer = await Viewer.findById(req.params.id).populate('box');
    
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    // Validate box status
    if (viewer.box.status !== 'running') {
      return res.status(400).json({ message: 'Box is not running. Start the box first.' });
    }
    
    if (streamUrl) {
      // Validate URL format for Kick.com
      if (!streamUrl.match(/^https?:\/\/(www\.)?kick\.com\/[a-zA-Z0-9_-]+$/)) {
        return res.status(400).json({ message: 'Invalid Kick.com URL' });
      }
      
      // Extract streamer name from URL
      const streamerName = streamUrl.split('/').pop();
      
      viewer.streamUrl = streamUrl;
      viewer.streamer = streamerName;
      
      // Check if stream exists in database, if not create it
      let stream = await Stream.findOne({ url: streamUrl });
      if (!stream) {
        stream = new Stream({
          url: streamUrl,
          streamer: streamerName,
          activeViewers: [viewer._id],
        });
        await stream.save();
      } else {
        // Add this viewer to active viewers if not already added
        if (!stream.activeViewers.includes(viewer._id)) {
          stream.activeViewers.push(viewer._id);
          await stream.save();
        }
      }
      
      // If viewer is idle, start it
      if (viewer.status === 'idle') {
        viewer.status = 'starting';
        await puppeteerService.saveViewerWithLock(viewer);
        
        // Start viewer async
        puppeteerService.startViewer(viewer._id)
          .then(() => {
            logger.info(`Viewer ${viewer.name} started successfully for stream: ${streamUrl}`);
          })
          .catch(async (error) => {
            viewer.status = 'error';
            viewer.error = `Failed to start: ${error.message}`;
            await puppeteerService.saveViewerWithLock(viewer);
            
            logger.error(`Failed to start viewer ${viewer.name}: ${error.message}`);
          });
      } else if (viewer.status === 'running') {
        // If viewer is already running, navigate to the new stream
        puppeteerService.navigateToStream(viewer._id, streamUrl)
          .then(() => {
            logger.info(`Viewer ${viewer.name} navigated to stream: ${streamUrl}`);
          })
          .catch(async (error) => {
            viewer.error = `Failed to navigate: ${error.message}`;
            await puppeteerService.saveViewerWithLock(viewer);
            
            logger.error(`Failed to navigate viewer ${viewer.name} to ${streamUrl}: ${error.message}`);
          });
      }
    }
    
    await puppeteerService.saveViewerWithLock(viewer);
    
    res.status(200).json(viewer);
  } catch (error) {
    logger.error(`Error updating viewer: ${error.message}`);
    res.status(500).json({ message: 'Error updating viewer', error: error.message });
  }
};

// Stop a viewer
exports.stopViewer = async (req, res) => {
  try {
    const viewer = await Viewer.findById(req.params.id);
    
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    // If viewer is already stopped or stopping, return error
    if (viewer.status === 'idle' || viewer.status === 'stopping') {
      return res.status(400).json({ message: 'Viewer is already stopped or stopping' });
    }
    
    // Update status to stopping
    viewer.status = 'stopping';
    await puppeteerService.saveViewerWithLock(viewer);
    
    // Stop viewer async
    puppeteerService.stopViewer(viewer._id)
      .then(async () => {
        // Update viewer
        viewer.status = 'idle';
        viewer.streamUrl = null;
        viewer.streamer = null;
        viewer.playbackStatus.isPlaying = false;
        await puppeteerService.saveViewerWithLock(viewer);
        
        // Remove from active viewers in stream
        if (viewer.streamUrl) {
          await Stream.updateOne(
            { url: viewer.streamUrl },
            { $pull: { activeViewers: viewer._id } }
          );
        }
        
        logger.info(`Viewer ${viewer.name} stopped successfully`);
      })
      .catch(async (error) => {
        // Failed to stop viewer
        viewer.status = 'error';
        viewer.error = `Failed to stop: ${error.message}`;
        await puppeteerService.saveViewerWithLock(viewer);
        
        logger.error(`Failed to stop viewer ${viewer.name}: ${error.message}`);
      });
    
    // Stop resource monitoring
    resourceMonitorService.stopViewerMonitoring(viewer._id);
    
    // Return immediate response
    res.status(200).json({ message: 'Viewer stopping', viewer });
  } catch (error) {
    logger.error(`Error stopping viewer: ${error.message}`);
    res.status(500).json({ message: 'Error stopping viewer', error: error.message });
  }
};

// Get viewer status
exports.getViewerStatus = async (req, res) => {
  try {
    const viewer = await Viewer.findById(req.params.id).populate('box', 'name status ipAddress');
    
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    res.status(200).json({
      _id: viewer._id,
      name: viewer.name,
      status: viewer.status,
      streamUrl: viewer.streamUrl,
      streamer: viewer.streamer,
      box: {
        _id: viewer.box._id,
        name: viewer.box.name,
        status: viewer.box.status,
        ipAddress: viewer.box.ipAddress
      },
      isParseChatEnabled: viewer.isParseChatEnabled,
      playbackStatus: viewer.playbackStatus,
      streamMetadata: viewer.streamMetadata,
      error: viewer.error,
      lastActivityAt: viewer.lastActivityAt,
      lastScreenshotTimestamp: viewer.lastScreenshotTimestamp
    });
  } catch (error) {
    logger.error(`Error getting viewer status: ${error.message}`);
    res.status(500).json({ message: 'Error retrieving viewer status', error: error.message });
  }
};

// Get viewer screenshot
exports.getViewerScreenshot = async (req, res) => {
  try {
    const viewer = await Viewer.findById(req.params.id);
    
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    // If viewer is not running, return error
    if (viewer.status !== 'running') {
      return res.status(400).json({ message: 'Viewer is not running' });
    }
    
    // Take screenshot async
    puppeteerService.takeScreenshot(viewer._id)
      .then(async (screenshotPath) => {
        // Update viewer with screenshot path
        viewer.lastScreenshotUrl = `/screenshots/${path.basename(screenshotPath)}`;
        viewer.lastScreenshotTimestamp = new Date();
        await puppeteerService.saveViewerWithLock(viewer);
        
        res.status(200).json({ 
          message: 'Screenshot taken successfully',
          screenshotUrl: viewer.lastScreenshotUrl,
          timestamp: viewer.lastScreenshotTimestamp
        });
      })
      .catch((error) => {
        logger.error(`Failed to take screenshot for viewer ${viewer.name}: ${error.message}`);
        res.status(500).json({ message: 'Failed to take screenshot', error: error.message });
      });
  } catch (error) {
    logger.error(`Error getting viewer screenshot: ${error.message}`);
    res.status(500).json({ message: 'Error taking screenshot', error: error.message });
  }
};

// Get viewer logs
exports.getViewerLogs = async (req, res) => {
  try {
    const viewer = await Viewer.findById(req.params.id);
    
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    // Get the most recent logs (last 100)
    const logs = viewer.logs.slice(-100);
    
    res.status(200).json(logs);
  } catch (error) {
    logger.error(`Error getting viewer logs: ${error.message}`);
    res.status(500).json({ message: 'Error retrieving viewer logs', error: error.message });
  }
};

// Serve screenshot image
exports.serveScreenshot = async (req, res) => {
  try {
    const screenshotPath = path.join(__dirname, '../screenshots', req.params.filename);
    
    // Check if file exists
    if (!fs.existsSync(screenshotPath)) {
      return res.status(404).json({ message: 'Screenshot not found' });
    }
    
    res.sendFile(screenshotPath);
  } catch (error) {
    logger.error(`Error serving screenshot: ${error.message}`);
    res.status(500).json({ message: 'Error serving screenshot', error: error.message });
  }
};

// Get viewer resource usage
exports.getViewerResourceUsage = async (req, res) => {
  try {
    const viewerId = req.params.id;
    
    // Check if viewer exists
    const viewer = await Viewer.findById(viewerId);
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    // Get resource usage
    const resourceUsage = await resourceMonitorService.getViewerResourceUsage(viewerId);
    
    res.status(200).json(resourceUsage);
  } catch (error) {
    logger.error(`Error getting viewer resource usage: ${error.message}`);
    res.status(500).json({ message: 'Error getting viewer resource usage', error: error.message });
  }
};

// Update viewer resource limits
exports.updateViewerResourceLimits = async (req, res) => {
  try {
    const viewerId = req.params.id;
    const { cpuLimit, memoryLimit, networkLimit } = req.body;
    
    // Check if viewer exists
    const viewer = await Viewer.findById(viewerId);
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    // Validate limits
    if (cpuLimit !== undefined && (isNaN(cpuLimit) || cpuLimit <= 0 || cpuLimit > 100)) {
      return res.status(400).json({ message: 'CPU limit must be a number between 1 and 100' });
    }
    
    if (memoryLimit !== undefined && (isNaN(memoryLimit) || memoryLimit <= 0)) {
      return res.status(400).json({ message: 'Memory limit must be a positive number' });
    }
    
    if (networkLimit !== undefined && (isNaN(networkLimit) || networkLimit <= 0)) {
      return res.status(400).json({ message: 'Network limit must be a positive number' });
    }
    
    // Update resource limits
    const limits = {};
    if (cpuLimit !== undefined) limits.cpuLimit = cpuLimit;
    if (memoryLimit !== undefined) limits.memoryLimit = memoryLimit;
    if (networkLimit !== undefined) limits.networkLimit = networkLimit;
    
    const updatedLimits = await resourceMonitorService.updateViewerResourceLimits(viewerId, limits);
    
    res.status(200).json(updatedLimits);
  } catch (error) {
    logger.error(`Error updating viewer resource limits: ${error.message}`);
    res.status(500).json({ message: 'Error updating viewer resource limits', error: error.message });
  }
};