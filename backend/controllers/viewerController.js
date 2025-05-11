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
    const { streamUrl, maxTabs } = req.body;
    
    const viewer = await Viewer.findById(req.params.id).populate('box');
    
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    // Validate box status
    if (viewer.box.status !== 'running') {
      return res.status(400).json({ message: 'Box is not running. Start the box first.' });
    }
    
    // Update maxTabs if provided (limit to 1-10 tabs)
    if (maxTabs !== undefined) {
      const numTabs = parseInt(maxTabs, 10);
      if (isNaN(numTabs) || numTabs < 1 || numTabs > 10) {
        return res.status(400).json({ message: 'maxTabs must be between 1 and 10' });
      }
      viewer.maxTabs = numTabs;
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
      
      // If viewer is idle, start it with the specified number of tabs
      if (viewer.status === 'idle') {
        viewer.status = 'starting';
        await puppeteerService.saveViewerWithLock(viewer);
        
        // Start viewer async with specified number of tabs
        puppeteerService.startViewer(viewer._id, viewer.maxTabs)
          .then(() => {
            logger.info(`Viewer ${viewer.name} started successfully with ${viewer.maxTabs} tabs for stream: ${streamUrl}`);
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
    // Check if the path includes a viewerId
    if (req.params.filename.includes('/')) {
      // Path format: viewerId/filename.jpg
      const parts = req.params.filename.split('/');
      const viewerId = parts[0];
      const filename = parts[1];
      const screenshotPath = path.join(__dirname, '../screenshots', viewerId, filename);
      
      // Check if file exists
      if (!fs.existsSync(screenshotPath)) {
        return res.status(404).json({ message: 'Screenshot not found' });
      }
      
      res.sendFile(screenshotPath);
    } else {
      // Old path format: just filename
      const screenshotPath = path.join(__dirname, '../screenshots', req.params.filename);
      
      // Check if file exists
      if (!fs.existsSync(screenshotPath)) {
        return res.status(404).json({ message: 'Screenshot not found' });
      }
      
      res.sendFile(screenshotPath);
    }
  } catch (error) {
    logger.error(`Error serving screenshot: ${error.message}`);
    res.status(500).json({ message: 'Error serving screenshot', error: error.message });
  }
};

// Force lowest quality (160p) for a viewer
exports.forceLowestQuality = async (req, res) => {
  try {
    const viewer = await Viewer.findById(req.params.id);
    
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    if (viewer.status !== 'running') {
      return res.status(400).json({ message: 'Viewer is not running' });
    }
    
    await puppeteerService.forceLowestQuality(req.params.id);
    
    res.status(200).json({ 
      message: `Successfully set lowest quality (160p) for viewer ${viewer.name}`,
      success: true
    });
  } catch (error) {
    logger.error(`Error setting lowest quality: ${error.message}`);
    res.status(500).json({ message: 'Error setting lowest quality', error: error.message });
  }
};

// Force lowest quality (160p) for all running viewers
exports.forceAllViewersLowestQuality = async (req, res) => {
  try {
    const results = await puppeteerService.forceAllViewersLowestQuality();
    
    res.status(200).json({
      message: `Operation completed: ${results.successful} viewers set to lowest quality, ${results.failed} failed`,
      ...results
    });
  } catch (error) {
    logger.error(`Error setting lowest quality for all viewers: ${error.message}`);
    res.status(500).json({ 
      message: 'Error setting lowest quality for all viewers', 
      error: error.message 
    });
  }
};

// Get tab screenshot
exports.getTabScreenshot = async (req, res) => {
  try {
    const { id: viewerId } = req.params;
    const { tabIndex } = req.body;
    
    const viewer = await Viewer.findById(viewerId);
    
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    if (viewer.status !== 'running') {
      return res.status(400).json({ message: 'Viewer is not running' });
    }
    
    // Validate tab index
    if (tabIndex === undefined || tabIndex < 0 || tabIndex >= viewer.tabs.length) {
      return res.status(400).json({ message: 'Invalid tab index' });
    }
    
    // Take screenshot for the specified tab
    await puppeteerService.takeTabScreenshot(viewerId, tabIndex);
    
    // Get updated viewer with screenshot URL
    const updatedViewer = await Viewer.findById(viewerId);
    
    res.status(200).json({
      message: 'Screenshot taken',
      tabIndex,
      screenshotUrl: updatedViewer.tabs[tabIndex].lastScreenshotUrl,
      timestamp: updatedViewer.tabs[tabIndex].lastScreenshotTimestamp
    });
  } catch (error) {
    logger.error(`Error taking tab screenshot: ${error.message}`);
    res.status(500).json({ message: 'Error taking screenshot', error: error.message });
  }
};

// Add a new tab to viewer
exports.addTab = async (req, res) => {
  try {
    const { id: viewerId } = req.params;
    
    const viewer = await Viewer.findById(viewerId);
    
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    if (viewer.status !== 'running') {
      return res.status(400).json({ message: 'Viewer must be running to add a tab' });
    }
    
    // Check if we've reached the maximum number of tabs
    if (viewer.tabs.length >= viewer.maxTabs) {
      return res.status(400).json({ 
        message: `Cannot add more tabs. Maximum of ${viewer.maxTabs} tabs allowed.` 
      });
    }
    
    // Add a new tab using puppeteer service
    await puppeteerService.addViewerTab(viewerId);
    
    // Get updated viewer
    const updatedViewer = await Viewer.findById(viewerId);
    
    res.status(200).json({
      message: 'Tab added successfully',
      tabs: updatedViewer.tabs
    });
  } catch (error) {
    logger.error(`Error adding tab: ${error.message}`);
    res.status(500).json({ message: 'Error adding tab', error: error.message });
  }
};

// Close a tab
exports.closeTab = async (req, res) => {
  try {
    const { id: viewerId } = req.params;
    const { tabIndex } = req.body;
    
    const viewer = await Viewer.findById(viewerId);
    
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    if (viewer.status !== 'running') {
      return res.status(400).json({ message: 'Viewer must be running to close a tab' });
    }
    
    // Validate tab index
    if (tabIndex === undefined || tabIndex < 0 || tabIndex >= viewer.tabs.length) {
      return res.status(400).json({ message: 'Invalid tab index' });
    }
    
    // Don't allow closing the last tab
    if (viewer.tabs.length <= 1) {
      return res.status(400).json({ message: 'Cannot close the last tab. Stop the viewer instead.' });
    }
    
    // Close the tab
    await puppeteerService.closeViewerTab(viewerId, tabIndex);
    
    // Get updated viewer
    const updatedViewer = await Viewer.findById(viewerId);
    
    res.status(200).json({
      message: 'Tab closed successfully',
      tabs: updatedViewer.tabs
    });
  } catch (error) {
    logger.error(`Error closing tab: ${error.message}`);
    res.status(500).json({ message: 'Error closing tab', error: error.message });
  }
};

// Get tab statistics
exports.getTabStats = async (req, res) => {
  try {
    const { id: viewerId } = req.params;
    
    const viewer = await Viewer.findById(viewerId);
    
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    if (viewer.status !== 'running') {
      return res.status(400).json({ message: 'Viewer is not running' });
    }
    
    // Get tab statistics
    const tabStats = await puppeteerService.getViewerTabStats(viewerId);
    
    res.status(200).json(tabStats);
  } catch (error) {
    logger.error(`Error getting tab stats: ${error.message}`);
    res.status(500).json({ message: 'Error getting tab stats', error: error.message });
  }
};

// Force lowest quality for a specific tab
exports.forceTabLowestQuality = async (req, res) => {
  try {
    const { id: viewerId } = req.params;
    const { tabIndex } = req.body;
    
    const viewer = await Viewer.findById(viewerId);
    
    if (!viewer) {
      return res.status(404).json({ message: 'Viewer not found' });
    }
    
    if (viewer.status !== 'running') {
      return res.status(400).json({ message: 'Viewer is not running' });
    }
    
    // Validate tab index
    if (tabIndex === undefined || tabIndex < 0 || tabIndex >= viewer.tabs.length) {
      return res.status(400).json({ message: 'Invalid tab index' });
    }
    
    // Force lowest quality for the tab
    await puppeteerService.forceTabLowestQuality(viewerId, tabIndex);
    
    res.status(200).json({
      message: `Forced lowest quality for tab ${tabIndex}`
    });
  } catch (error) {
    logger.error(`Error forcing lowest quality: ${error.message}`);
    res.status(500).json({ message: 'Error forcing lowest quality', error: error.message });
  }
};