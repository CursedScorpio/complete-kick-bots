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
    const { name, vpnConfig, streamUrl, viewersPerBox } = req.body;
    
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
    
    // Validate viewersPerBox if provided
    const viewersCount = viewersPerBox ? parseInt(viewersPerBox, 10) : config.viewer.instancesPerBox;
    if (isNaN(viewersCount) || viewersCount < 1 || viewersCount > 50) {
      return res.status(400).json({ message: 'Viewers per box must be between 1 and 50' });
    }
    
    const newBox = new Box({
      name,
      vpnConfig,
      status: 'idle',
      streamUrl,
      viewersPerBox: viewersCount,
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
    const { name, vpnConfig, streamUrl, viewersPerBox } = req.body;
    const box = await Box.findById(req.params.id);
    
    if (!box) {
      return res.status(404).json({ message: 'Box not found' });
    }
    
    // Check if box is running or starting - prevent VPN changes in these states
    if (['running', 'starting'].includes(box.status) && vpnConfig !== box.vpnConfig) {
      return res.status(400).json({ message: 'Cannot change VPN configuration while box is running' });
    }
    
    // Validate VPN config if changed
    if (vpnConfig && vpnConfig !== box.vpnConfig) {
      const vpnExists = await vpnService.checkVpnConfigExists(vpnConfig);
      if (!vpnExists) {
        return res.status(400).json({ message: 'VPN configuration not found' });
      }
    }
    
    // Validate stream URL if provided
    if (streamUrl && !streamUrl.match(/^https?:\/\/(www\.)?kick\.com\/[a-zA-Z0-9_-]+$/)) {
      return res.status(400).json({ message: 'Invalid Kick.com URL' });
    }
    
    // Validate viewersPerBox if provided
    if (viewersPerBox !== undefined) {
      const viewersCount = parseInt(viewersPerBox, 10);
      if (isNaN(viewersCount) || viewersCount < 1 || viewersCount > 50) {
        return res.status(400).json({ message: 'Viewers per box must be between 1 and 50' });
      }
      
      // Can't change viewers count when running
      if (['running', 'starting'].includes(box.status) && viewersCount !== box.viewersPerBox) {
        return res.status(400).json({ message: 'Cannot change viewers count while box is running' });
      }
      
      box.viewersPerBox = viewersCount;
    }
    
    // Update box
    if (name) box.name = name;
    if (vpnConfig) box.vpnConfig = vpnConfig;
    box.streamUrl = streamUrl || null; // Allow clearing streamUrl
    
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
        
        // Create viewers sequentially to avoid parallel save issues
        for (let i = 0; i < box.viewersPerBox; i++) {
          try {
            // Add a small delay between each viewer creation to prevent parallel saves
            if (i > 0) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            
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
            
            // Use saveViewerWithLock to prevent parallel save issues
            const savedViewer = await puppeteerService.saveViewerWithLock(viewer);
            viewers.push(savedViewer);
            
            // Add viewer to stream's active viewers if it exists
            if (stream) {
              stream.activeViewers.push(savedViewer._id);
            }
            
            // Let MongoDB process the save before moving to the next one
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            logger.error(`Error creating viewer ${i+1} for box ${box.name}: ${error.message}`);
            // Continue to next viewer
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
        
        // Improved auto-start all viewers with batching to reduce total startup time
        const startViewersWithBatch = async () => {
          // Configuration for batching
          const BATCH_SIZE = 3; // Number of viewers to start in parallel
          const BATCH_DELAY_MS = 5000; // Delay between batches
          const VIEWERS_PER_BATCH_DELAY_MS = 500; // Small delay between viewers in the same batch
          
          // Process viewers in batches
          for (let batchIndex = 0; batchIndex < Math.ceil(viewers.length / BATCH_SIZE); batchIndex++) {
            const batchStartIndex = batchIndex * BATCH_SIZE;
            const batchEndIndex = Math.min(batchStartIndex + BATCH_SIZE, viewers.length);
            const currentBatch = viewers.slice(batchStartIndex, batchEndIndex);
            
            logger.info(`Starting batch ${batchIndex + 1} with ${currentBatch.length} viewers (${batchStartIndex + 1}-${batchEndIndex}/${viewers.length})`);
            
            // Start a batch of viewers with small delays between them
            const batchPromises = currentBatch.map(async (viewer, indexInBatch) => {
              try {
                // Small delay between viewers in the same batch
                await new Promise(resolve => setTimeout(resolve, indexInBatch * VIEWERS_PER_BATCH_DELAY_MS));
                
                // Make sure the viewer document still exists before starting
                const viewerExists = await Viewer.findById(viewer._id);
                if (!viewerExists) {
                  logger.warn(`Viewer ${viewer.name} (${viewer._id}) no longer exists, skipping auto-start`);
                  return;
                }
                
                const viewerNumber = batchStartIndex + indexInBatch + 1;
                logger.info(`Attempting to auto-start viewer ${viewer.name} (${viewerNumber}/${viewers.length})`);
                
                // Start viewer
                try {
                  await puppeteerService.startViewer(viewer._id);
                  logger.info(`Viewer ${viewer.name} auto-started successfully for stream: ${viewer.streamUrl}`);
                } catch (error) {
                  logger.error(`Failed to auto-start viewer ${viewer.name}: ${error.message}`);
                  
                  // Update viewer with error
                  try {
                    viewerExists.status = 'error';
                    viewerExists.error = `Auto-start failed: ${error.message}`;
                    await puppeteerService.saveViewerWithLock(viewerExists);
                  } catch (saveError) {
                    logger.error(`Failed to update viewer ${viewer.name} after auto-start failure: ${saveError.message}`);
                  }
                }
              } catch (error) {
                logger.error(`Error when trying to auto-start viewer ${viewer.name}: ${error.message}`);
              }
            });
            
            // Wait for all viewers in the current batch to complete their startup process
            await Promise.all(batchPromises);
            
            // Delay between batches to prevent system overload
            if (batchIndex < Math.ceil(viewers.length / BATCH_SIZE) - 1) {
              logger.info(`Batch ${batchIndex + 1} complete, waiting ${BATCH_DELAY_MS}ms before starting next batch`);
              await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }
          }
          
          logger.info(`All ${viewers.length} viewers have been started`);
        };
        
        // Start the viewers with batch processing
        startViewersWithBatch();
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