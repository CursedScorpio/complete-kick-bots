const os = require('os');
const logger = require('../utils/logger');
const resourceManager = require('../utils/resourceManager');
const mongoose = require('mongoose');
const Viewer = require('../models/Viewer');
const Box = require('../models/Box');
const Stream = require('../models/Stream');

// Get system health status
exports.getHealth = async (req, res) => {
  try {
    // Basic system info
    const systemInfo = {
      status: 'ok',
      timestamp: new Date(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      hostname: os.hostname(),
      platform: process.platform,
      memory: {
        total: Math.round(os.totalmem() / (1024 * 1024)) + ' MB',
        free: Math.round(os.freemem() / (1024 * 1024)) + ' MB',
        used: Math.round((os.totalmem() - os.freemem()) / (1024 * 1024)) + ' MB',
        process: {
          rss: Math.round(process.memoryUsage().rss / (1024 * 1024)) + ' MB',
          heapTotal: Math.round(process.memoryUsage().heapTotal / (1024 * 1024)) + ' MB',
          heapUsed: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)) + ' MB',
        }
      },
      cpu: {
        model: os.cpus()[0].model,
        cores: os.cpus().length,
        loadAvg: os.loadavg(),
      }
    };
    
    // DB connection status
    systemInfo.database = {
      connected: mongoose.connection.readyState === 1,
      status: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown'
    };
    
    res.status(200).json(systemInfo);
  } catch (error) {
    logger.error(`Error getting system health: ${error.message}`);
    res.status(500).json({ message: 'Error retrieving system health', error: error.message });
  }
};

// Get system metrics
exports.getMetrics = async (req, res) => {
  try {
    // Get counts from DB
    const viewerCount = await Viewer.countDocuments();
    const runningViewers = await Viewer.countDocuments({ status: 'running' });
    const boxCount = await Box.countDocuments();
    const runningBoxes = await Box.countDocuments({ status: 'running' });
    const streamCount = await Stream.countDocuments();
    const activeStreams = await Stream.countDocuments({ activeViewers: { $exists: true, $not: { $size: 0 } } });
    
    // Build metrics object
    const metrics = {
      timestamp: new Date(),
      system: {
        uptime: process.uptime(),
        memory: {
          total: Math.round(os.totalmem() / (1024 * 1024)),
          free: Math.round(os.freemem() / (1024 * 1024)),
          used: Math.round((os.totalmem() - os.freemem()) / (1024 * 1024)),
          processRSS: Math.round(process.memoryUsage().rss / (1024 * 1024)),
          processHeapUsed: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
        },
        loadAvg: os.loadavg(),
      },
      application: {
        viewers: {
          total: viewerCount,
          running: runningViewers,
          idle: viewerCount - runningViewers,
        },
        boxes: {
          total: boxCount,
          running: runningBoxes,
          idle: boxCount - runningBoxes,
        },
        streams: {
          total: streamCount,
          active: activeStreams,
          inactive: streamCount - activeStreams,
        }
      }
    };
    
    // Add resource manager metrics if initialized
    if (resourceManager.getMetrics) {
      metrics.resourceManager = resourceManager.getMetrics();
    }
    
    res.status(200).json(metrics);
  } catch (error) {
    logger.error(`Error getting system metrics: ${error.message}`);
    res.status(500).json({ message: 'Error retrieving system metrics', error: error.message });
  }
};

// Get resource manager metrics
exports.getResourceManagerMetrics = async (req, res) => {
  try {
    if (!resourceManager.getMetrics) {
      return res.status(503).json({ message: 'Resource manager not initialized' });
    }
    
    const metrics = resourceManager.getMetrics();
    res.status(200).json(metrics);
  } catch (error) {
    logger.error(`Error getting resource manager metrics: ${error.message}`);
    res.status(500).json({ message: 'Error retrieving resource manager metrics', error: error.message });
  }
};

// Update resource manager configuration
exports.updateResourceManagerConfig = async (req, res) => {
  try {
    if (!resourceManager.updateConfig) {
      return res.status(503).json({ message: 'Resource manager not initialized' });
    }
    
    const { 
      checkInterval,
      idleTimeout,
      memoryThresholdMB,
      maxViewerMemoryMB,
      gcAfterStoppedViewers,
      debug
    } = req.body;
    
    // Validate inputs
    const config = {};
    
    if (checkInterval !== undefined) {
      const intervalMs = parseInt(checkInterval, 10);
      if (isNaN(intervalMs) || intervalMs < 10000) {
        return res.status(400).json({ message: 'checkInterval must be at least 10000ms (10 seconds)' });
      }
      config.checkInterval = intervalMs;
    }
    
    if (idleTimeout !== undefined) {
      const timeoutMs = parseInt(idleTimeout, 10);
      if (isNaN(timeoutMs) || timeoutMs < 60000) {
        return res.status(400).json({ message: 'idleTimeout must be at least 60000ms (1 minute)' });
      }
      config.idleTimeout = timeoutMs;
    }
    
    if (memoryThresholdMB !== undefined) {
      const memoryMB = parseInt(memoryThresholdMB, 10);
      if (isNaN(memoryMB) || memoryMB < 100) {
        return res.status(400).json({ message: 'memoryThresholdMB must be at least 100MB' });
      }
      config.memoryThresholdMB = memoryMB;
    }
    
    if (maxViewerMemoryMB !== undefined) {
      const memoryMB = parseInt(maxViewerMemoryMB, 10);
      if (isNaN(memoryMB) || memoryMB < 50) {
        return res.status(400).json({ message: 'maxViewerMemoryMB must be at least 50MB' });
      }
      config.maxViewerMemoryMB = memoryMB;
    }
    
    if (gcAfterStoppedViewers !== undefined) {
      const count = parseInt(gcAfterStoppedViewers, 10);
      if (isNaN(count) || count < 1) {
        return res.status(400).json({ message: 'gcAfterStoppedViewers must be at least 1' });
      }
      config.gcAfterStoppedViewers = count;
    }
    
    if (debug !== undefined) {
      config.debug = !!debug;
    }
    
    // Update the configuration
    resourceManager.updateConfig(config);
    
    res.status(200).json({ 
      message: 'Resource manager configuration updated',
      appliedChanges: config
    });
  } catch (error) {
    logger.error(`Error updating resource manager config: ${error.message}`);
    res.status(500).json({ message: 'Error updating resource manager configuration', error: error.message });
  }
};

// Trigger a resource check
exports.triggerResourceCheck = async (req, res) => {
  try {
    if (!resourceManager.checkResources) {
      return res.status(503).json({ message: 'Resource manager not initialized' });
    }
    
    // Run the check asynchronously
    resourceManager.checkResources();
    
    res.status(200).json({ message: 'Resource check initiated' });
  } catch (error) {
    logger.error(`Error triggering resource check: ${error.message}`);
    res.status(500).json({ message: 'Error triggering resource check', error: error.message });
  }
};

// Trigger stopping idle viewers
exports.triggerStopIdleViewers = async (req, res) => {
  try {
    if (!resourceManager.stopIdleViewers) {
      return res.status(503).json({ message: 'Resource manager not initialized' });
    }
    
    // Get force parameter (to force stop even if not very idle)
    const force = req.body.force === true;
    
    // Run the operation asynchronously
    resourceManager.stopIdleViewers(!force);
    
    res.status(200).json({ message: 'Stop idle viewers initiated', force });
  } catch (error) {
    logger.error(`Error triggering stop idle viewers: ${error.message}`);
    res.status(500).json({ message: 'Error triggering stop idle viewers', error: error.message });
  }
}; 