// controllers/boxController.js
const Box = require('../models/Box');
const Viewer = require('../models/Viewer');
const Stream = require('../models/Stream');
const vpnService = require('../services/vpnService');
const puppeteerService = require('../services/puppeteerService');
const logger = require('../utils/logger');
const config = require('../config/config');

// Get all boxes
exports.getAllBoxes = async (req, res) => {
  try {
    const boxes = await Box.find().populate('viewers', 'name status streamUrl');
    res.status(200).json(boxes);
  } catch (error) {
    logger.error(`Error getting boxes: ${error.message}`);
    res.status(500).json({ message: 'Error retrieving boxes', error: error.message });
  }
};

// Get box by ID
exports.getBoxById = async (req, res) => {
  try {
    const box = await Box.findById(req.params.id).populate('viewers');
    
    if (!box) {
      return res.status(404).json({ message: 'Box not found' });
    }
    
    res.status(200).json(box);
  } catch (error) {
    logger.error(`Error getting box: ${error.message}`);
    res.status(500).json({ message: 'Error retrieving box', error: error.message });
  }
};

// Create a new box
exports.createBox = async (req, res) => {
  try {
    const { name, vpnConfig, streamUrl } = req.body;
    
    if (!name || !vpnConfig) {
      return res.status(400).json({ message: 'Name and VPN config are required' });
    }
    
    // Check if VPN config exists
    const vpnExists = await vpnService.checkVpnConfigExists(vpnConfig);
    if (!vpnExists) {
      return res.status(400).json({ message: 'VPN configuration not found' });
    }
    
    // Validate stream URL if provided
    if (streamUrl && !streamUrl.match(/^https?:\/\/(www\.)?kick\.com\/[a-zA-Z0-9_-]+$/)) {
      return res.status(400).json({ message: 'Invalid Kick.com URL' });
    }
    
    const newBox = new Box({
      name,
      vpnConfig,
      status: 'idle',
      streamUrl,
    });
    
    await newBox.save();
    
    res.status(201).json(newBox);
  } catch (error) {
    logger.error(`Error creating box: ${error.message}`);
    res.status(500).json({ message: 'Error creating box', error: error.message });
  }
};

// Update a box
exports.updateBox = async (req, res) => {
  try {
    const { name, vpnConfig } = req.body;
    
    const box = await Box.findById(req.params.id);
    
    if (!box) {
      return res.status(404).json({ message: 'Box not found' });
    }
    
    // If status is not idle, don't allow updates
    if (box.status !== 'idle') {
      return res.status(400).json({ message: 'Cannot update box while it is active. Please stop it first.' });
    }
    
    if (name) box.name = name;
    
    if (vpnConfig && vpnConfig !== box.vpnConfig) {
      // Check if VPN config exists
      const vpnExists = await vpnService.checkVpnConfigExists(vpnConfig);
      if (!vpnExists) {
        return res.status(400).json({ message: 'VPN configuration not found' });
      }
      
      box.vpnConfig = vpnConfig;
    }
    
    await box.save();
    
    res.status(200).json(box);
  } catch (error) {
    logger.error(`Error updating box: ${error.message}`);
    res.status(500).json({ message: 'Error updating box', error: error.message });
  }
};

// Delete a box
exports.deleteBox = async (req, res) => {
  try {
    const box = await Box.findById(req.params.id);
    
    if (!box) {
      return res.status(404).json({ message: 'Box not found' });
    }
    
    // If status is not idle or error, don't allow deletion
    if (box.status !== 'idle' && box.status !== 'error') {
      return res.status(400).json({ message: 'Cannot delete box while it is active. Please stop it first.' });
    }
    
    // Delete all viewers associated with this box
    await Viewer.deleteMany({ box: box._id });
    
    // Delete the box
    await Box.findByIdAndDelete(req.params.id);
    
    res.status(200).json({ message: 'Box deleted successfully' });
  } catch (error) {
    logger.error(`Error deleting box: ${error.message}`);
    res.status(500).json({ message: 'Error deleting box', error: error.message });
  }
};

// Start a box
exports.startBox = async (req, res) => {
  try {
    const box = await Box.findById(req.params.id);
    
    if (!box) {
      return res.status(404).json({ message: 'Box not found' });
    }
    
    // If box is already running or starting, return error
    if (box.status === 'running' || box.status === 'starting') {
      return res.status(400).json({ message: 'Box is already active' });
    }
    
    // Update status to starting
    box.status = 'starting';
    box.error = null;
    await box.save();
    
    // Start VPN connection async
    vpnService.connectVpn(box._id, box.vpnConfig)
      .then(async () => {
        // VPN connected successfully, create viewers
        const viewers = [];
        
        // Extract streamer name from URL if streamUrl exists
        const streamer = box.streamUrl ? box.streamUrl.split('/').pop() : null;
        
        // Check if stream exists in database, if not create it
        let stream = null;
        if (box.streamUrl) {
          stream = await Stream.findOne({ url: box.streamUrl });
          if (!stream) {
            stream = new Stream({
              url: box.streamUrl,
              streamer: streamer,
              activeViewers: [],
            });
            await stream.save();
          }
        }
        
        for (let i = 0; i < config.viewer.instancesPerBox; i++) {
          const viewer = new Viewer({
            box: box._id,
            name: `${box.name}-Viewer-${i+1}`,
            status: 'idle',
            // Assign streamUrl and streamer if available
            streamUrl: box.streamUrl || null,
            streamer: streamer || null,
            // Only one viewer per box will parse chat
            isParseChatEnabled: i === 0, // First viewer parses chat
          });
          
          await puppeteerService.saveViewerWithLock(viewer);
          viewers.push(viewer);
          
          // Add viewer to stream's active viewers if it exists
          if (stream) {
            stream.activeViewers.push(viewer._id);
          }
        }
        
        // Save stream if it exists
        if (stream) {
          await stream.save();
        }
        
        // Update box with viewers and status
        box.viewers = viewers.map(v => v._id);
        box.status = 'running';
        box.startedAt = new Date();
        await box.save();
        
        logger.info(`Box ${box.name} started successfully with ${viewers.length} viewers`);
        
        // Auto-start all viewers with delays to prevent request flooding
        const startViewersWithDelay = async () => {
          for (let i = 0; i < viewers.length; i++) {
            const viewer = viewers[i];
            try {
              // Add a delay between starting each viewer to prevent request flooding
              await new Promise(resolve => setTimeout(resolve, i * 2000));
              
              // Start viewer async
              puppeteerService.startViewer(viewer._id)
                .then(() => {
                  logger.info(`Viewer ${viewer.name} auto-started successfully for stream: ${viewer.streamUrl}`);
                })
                .catch(async (error) => {
                  logger.error(`Failed to auto-start viewer ${viewer.name}: ${error.message}`);
                });
            } catch (error) {
              logger.error(`Error when trying to auto-start viewer ${viewer.name}: ${error.message}`);
            }
          }
        };
        
        // Start the viewers with delay
        startViewersWithDelay();
      })
      .catch(async (error) => {
        // VPN connection failed
        box.status = 'error';
        box.error = `Failed to start VPN: ${error.message}`;
        await box.save();
        
        logger.error(`Failed to start box ${box.name}: ${error.message}`);
      });
    
    // Return immediate response
    res.status(200).json({ message: 'Box starting', box });
  } catch (error) {
    logger.error(`Error starting box: ${error.message}`);
    res.status(500).json({ message: 'Error starting box', error: error.message });
  }
};

// Stop a box
exports.stopBox = async (req, res) => {
  try {
    const box = await Box.findById(req.params.id);
    
    if (!box) {
      return res.status(404).json({ message: 'Box not found' });
    }
    
    // If box is already stopped or stopping, return error
    if (box.status === 'idle' || box.status === 'stopping') {
      return res.status(400).json({ message: 'Box is already stopped or stopping' });
    }
    
    // Update status to stopping
    box.status = 'stopping';
    await box.save();
    
    // Stop all viewers
    const viewers = await Viewer.find({ box: box._id });
    for (const viewer of viewers) {
      viewer.status = 'stopping';
      await viewer.save();
    }
    
    // Disconnect VPN async
    vpnService.disconnectVpn(box._id)
      .then(async () => {
        // Update viewers
        for (const viewer of viewers) {
          viewer.status = 'idle';
          viewer.streamUrl = null;
          viewer.streamer = null;
          viewer.playbackStatus.isPlaying = false;
          await viewer.save();
        }
        
        // Update box
        box.status = 'idle';
        box.ipAddress = null;
        box.location = null;
        box.startedAt = null;
        await box.save();
        
        logger.info(`Box ${box.name} stopped successfully`);
      })
      .catch(async (error) => {
        // Failed to disconnect VPN
        box.status = 'error';
        box.error = `Failed to stop VPN: ${error.message}`;
        await box.save();
        
        logger.error(`Failed to stop box ${box.name}: ${error.message}`);
      });
    
    // Return immediate response
    res.status(200).json({ message: 'Box stopping', box });
  } catch (error) {
    logger.error(`Error stopping box: ${error.message}`);
    res.status(500).json({ message: 'Error stopping box', error: error.message });
  }
};

// Get box status
exports.getBoxStatus = async (req, res) => {
  try {
    const box = await Box.findById(req.params.id)
      .populate('viewers', 'name status streamUrl streamer error');
    
    if (!box) {
      return res.status(404).json({ message: 'Box not found' });
    }
    
    res.status(200).json({
      _id: box._id,
      name: box.name,
      status: box.status,
      ipAddress: box.ipAddress,
      location: box.location,
      error: box.error,
      startedAt: box.startedAt,
      viewersCount: box.viewers.length,
      activeViewersCount: box.viewers.filter(v => v.status === 'running').length,
      viewers: box.viewers.map(v => ({
        _id: v._id,
        name: v.name,
        status: v.status,
        streamUrl: v.streamUrl,
        streamer: v.streamer,
        error: v.error
      }))
    });
  } catch (error) {
    logger.error(`Error getting box status: ${error.message}`);
    res.status(500).json({ message: 'Error retrieving box status', error: error.message });
  }
};

// Refresh a box's VPN IP information
exports.refreshBoxIp = async (req, res) => {
  try {
    const box = await Box.findById(req.params.id);
    
    if (!box) {
      return res.status(404).json({ message: 'Box not found' });
    }
    
    // Only allow refresh if box is running
    if (box.status !== 'running') {
      return res.status(400).json({ message: 'Cannot refresh IP for inactive box. Box must be running.' });
    }
    
    // Get the interface for this box
    const interfaceName = vpnService.getBoxInterface(box._id);
    
    if (!interfaceName) {
      return res.status(400).json({ message: 'No active VPN interface found for this box' });
    }
    
    // Get updated IP info from the correct interface
    const ipInfo = await vpnService.getVpnIpInfo(interfaceName);
    
    // Update box with the refreshed IP information
    box.ipAddress = ipInfo.ip;
    box.location = ipInfo.location;
    await box.save();
    
    logger.info(`Refreshed VPN IP for box ${box.name}: ${ipInfo.ip} (${ipInfo.location})`);
    
    res.status(200).json({
      message: 'Box IP refreshed successfully',
      ipAddress: ipInfo.ip,
      location: ipInfo.location
    });
  } catch (error) {
    logger.error(`Error refreshing box IP: ${error.message}`);
    res.status(500).json({ message: 'Error refreshing box IP', error: error.message });
  }
};