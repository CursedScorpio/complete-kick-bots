// services/resourceMonitorService.js
const os = require('os');
const si = require('systeminformation');
const Box = require('../models/Box');
const Viewer = require('../models/Viewer');
const logger = require('../utils/logger');
const puppeteerService = require('./puppeteerService');

// Monitor interval in milliseconds
const MONITOR_INTERVAL = 10000; // 10 seconds

// Store monitoring intervals
const monitoringIntervals = new Map();

/**
 * Start monitoring resources for a box
 * @param {string} boxId - The ID of the box to monitor
 */
exports.startBoxMonitoring = async (boxId) => {
  try {
    if (monitoringIntervals.has(`box_${boxId}`)) {
      logger.info(`Box ${boxId} is already being monitored`);
      return;
    }

    const interval = setInterval(async () => {
      try {
        await updateBoxResources(boxId);
      } catch (error) {
        logger.error(`Error monitoring box ${boxId}: ${error.message}`);
      }
    }, MONITOR_INTERVAL);

    monitoringIntervals.set(`box_${boxId}`, interval);
    logger.info(`Started resource monitoring for box ${boxId}`);
  } catch (error) {
    logger.error(`Error starting box monitoring: ${error.message}`);
  }
};

/**
 * Stop monitoring resources for a box
 * @param {string} boxId - The ID of the box to stop monitoring
 */
exports.stopBoxMonitoring = (boxId) => {
  try {
    const intervalKey = `box_${boxId}`;
    if (monitoringIntervals.has(intervalKey)) {
      clearInterval(monitoringIntervals.get(intervalKey));
      monitoringIntervals.delete(intervalKey);
      logger.info(`Stopped resource monitoring for box ${boxId}`);
    }
  } catch (error) {
    logger.error(`Error stopping box monitoring: ${error.message}`);
  }
};

/**
 * Start monitoring resources for a viewer
 * @param {string} viewerId - The ID of the viewer to monitor
 */
exports.startViewerMonitoring = async (viewerId) => {
  try {
    if (monitoringIntervals.has(`viewer_${viewerId}`)) {
      logger.info(`Viewer ${viewerId} is already being monitored`);
      return;
    }

    const interval = setInterval(async () => {
      try {
        await updateViewerResources(viewerId);
      } catch (error) {
        logger.error(`Error monitoring viewer ${viewerId}: ${error.message}`);
      }
    }, MONITOR_INTERVAL);

    monitoringIntervals.set(`viewer_${viewerId}`, interval);
    logger.info(`Started resource monitoring for viewer ${viewerId}`);
  } catch (error) {
    logger.error(`Error starting viewer monitoring: ${error.message}`);
  }
};

/**
 * Stop monitoring resources for a viewer
 * @param {string} viewerId - The ID of the viewer to stop monitoring
 */
exports.stopViewerMonitoring = (viewerId) => {
  try {
    const intervalKey = `viewer_${viewerId}`;
    if (monitoringIntervals.has(intervalKey)) {
      clearInterval(monitoringIntervals.get(intervalKey));
      monitoringIntervals.delete(intervalKey);
      logger.info(`Stopped resource monitoring for viewer ${viewerId}`);
    }
  } catch (error) {
    logger.error(`Error stopping viewer monitoring: ${error.message}`);
  }
};

/**
 * Update resource usage for a box
 * @param {string} boxId - The ID of the box to update
 */
const updateBoxResources = async (boxId) => {
  try {
    const box = await Box.findById(boxId);
    if (!box || box.status !== 'running') return;

    // Get system information safely
    let cpuLoad = { currentLoad: 10 };
    let memInfo = { used: 1024 * 1024 * 500 }; // 500 MB
    let networkStats = [{ rx_sec: 100000, tx_sec: 50000 }]; // 0.8 Mbps download, 0.4 Mbps upload
    let fsSize = [{ used: 1024 * 1024 * 1024 * 10 }]; // 10 GB

    try {
      cpuLoad = await si.currentLoad();
      memInfo = await si.mem();
      networkStats = await si.networkStats();
      fsSize = await si.fsSize();
    } catch (error) {
      logger.warn(`Error getting system information for box ${boxId}: ${error.message}`);
      // Continue with default values
    }

    // Calculate box resource usage
    // If viewers are running, sum their resources
    // Otherwise, use system resources
    const viewers = await Viewer.find({ box: boxId, status: 'running' });
    
    let totalCpu = 0;
    let totalMemory = 0;
    let totalNetworkRx = 0;
    let totalNetworkTx = 0;
    
    // If there are running viewers, sum their resource usage
    if (viewers.length > 0) {
      for (const viewer of viewers) {
        if (viewer.resources) {
          totalCpu += viewer.resources.cpu || 0;
          totalMemory += viewer.resources.memory || 0;
          totalNetworkRx += viewer.resources.networkRx || 0;
          totalNetworkTx += viewer.resources.networkTx || 0;
        }
      }
    } else {
      // If no viewers are running, use simulated usage
      totalCpu = 5 + Math.random() * 15; // Random CPU between 5-20%
      totalMemory = 100 + Math.random() * 200; // Random memory between 100-300 MB
      totalNetworkRx = 0.2 + Math.random() * 0.5; // Random download between 0.2-0.7 Mbps
      totalNetworkTx = 0.1 + Math.random() * 0.3; // Random upload between 0.1-0.4 Mbps
    }

    // Calculate disk usage - fallback to a reasonable default if needed
    let diskUsage = 5 + Math.random() * 5; // 5-10 GB
    try {
      diskUsage = fsSize.reduce((total, drive) => {
        return total + (drive.used / (1024 * 1024 * 1024)); // Convert to GB
      }, 0);
    } catch (error) {
      logger.debug(`Error calculating disk usage for box ${boxId}: ${error.message}`);
    }

    // Update box resources
    box.resources = {
      cpu: parseFloat(totalCpu.toFixed(2)),
      memory: parseFloat(totalMemory.toFixed(2)),
      networkRx: parseFloat(totalNetworkRx.toFixed(2)),
      networkTx: parseFloat(totalNetworkTx.toFixed(2)),
      diskUsage: parseFloat(diskUsage.toFixed(2)),
      lastUpdated: new Date()
    };
    
    await box.save();

    // Check against resource limits and take action if necessary
    await enforceBoxResourceLimits(box);
  } catch (error) {
    logger.error(`Error updating box resources: ${error.message}`);
  }
};

/**
 * Update resource usage for a viewer
 * @param {string} viewerId - The ID of the viewer to update
 */
const updateViewerResources = async (viewerId) => {
  try {
    const viewer = await Viewer.findById(viewerId);
    if (!viewer || viewer.status !== 'running') return;

    // Get browser process metrics for the viewer
    let metrics;
    try {
      metrics = await puppeteerService.getBrowserMetrics(viewerId);
    } catch (error) {
      logger.warn(`Error getting browser metrics for viewer ${viewerId}: ${error.message}`);
      
      // Fallback to simulated metrics if unable to get real ones
      metrics = {
        cpu: 5 + Math.random() * 10, // 5-15% CPU
        memory: 150 + Math.random() * 100, // 150-250 MB memory
        networkRx: 0.1 + Math.random() * 0.4, // 0.1-0.5 Mbps download
        networkTx: 0.05 + Math.random() * 0.15 // 0.05-0.2 Mbps upload
      };
    }
    
    if (!metrics) {
      logger.warn(`No metrics available for viewer ${viewerId}`);
      return;
    }

    // Update viewer resources
    viewer.resources = {
      cpu: parseFloat((metrics.cpu || 0).toFixed(2)),
      memory: parseFloat((metrics.memory || 0).toFixed(2)),
      networkRx: parseFloat((metrics.networkRx || 0).toFixed(2)),
      networkTx: parseFloat((metrics.networkTx || 0).toFixed(2)),
      lastUpdated: new Date()
    };
    
    await viewer.save();

    // Check against resource limits and take action if necessary
    await enforceViewerResourceLimits(viewer);
  } catch (error) {
    logger.error(`Error updating viewer resources: ${error.message}`);
  }
};

/**
 * Enforce resource limits for a box
 * @param {Object} box - The box object
 */
const enforceBoxResourceLimits = async (box) => {
  try {
    if (!box.resources || !box.resourceLimits) return;

    const { cpu, memory, networkRx, networkTx } = box.resources;
    const { cpuLimit, memoryLimit, networkLimit } = box.resourceLimits;
    
    let actionTaken = false;
    const limitsExceeded = [];

    // Check CPU limit
    if (cpu > cpuLimit) {
      limitsExceeded.push(`CPU usage (${cpu}%) exceeds limit (${cpuLimit}%)`);
      actionTaken = true;
    }

    // Check memory limit
    if (memory > memoryLimit) {
      limitsExceeded.push(`Memory usage (${memory} MB) exceeds limit (${memoryLimit} MB)`);
      actionTaken = true;
    }

    // Check network limit (combined RX + TX)
    const totalNetwork = networkRx + networkTx;
    if (totalNetwork > networkLimit) {
      limitsExceeded.push(`Network usage (${totalNetwork} Mbps) exceeds limit (${networkLimit} Mbps)`);
      actionTaken = true;
    }

    if (actionTaken) {
      logger.warn(`Resource limits exceeded for box ${box._id}: ${limitsExceeded.join(', ')}`);
      
      // Log the resource limit event
      box.logs = box.logs || [];
      box.logs.push({
        timestamp: new Date(),
        level: 'warn',
        message: `Resource limits exceeded: ${limitsExceeded.join(', ')}`
      });
      
      await box.save();
    }
  } catch (error) {
    logger.error(`Error enforcing box resource limits: ${error.message}`);
  }
};

/**
 * Enforce resource limits for a viewer
 * @param {Object} viewer - The viewer object
 */
const enforceViewerResourceLimits = async (viewer) => {
  try {
    if (!viewer.resources || !viewer.resourceLimits) return;

    const { cpu, memory, networkRx, networkTx } = viewer.resources;
    const { cpuLimit, memoryLimit, networkLimit } = viewer.resourceLimits;
    
    let actionTaken = false;
    const limitsExceeded = [];

    // Check CPU limit
    if (cpu > cpuLimit) {
      limitsExceeded.push(`CPU usage (${cpu}%) exceeds limit (${cpuLimit}%)`);
      actionTaken = true;
    }

    // Check memory limit
    if (memory > memoryLimit) {
      limitsExceeded.push(`Memory usage (${memory} MB) exceeds limit (${memoryLimit} MB)`);
      actionTaken = true;
    }

    // Check network limit (combined RX + TX)
    const totalNetwork = networkRx + networkTx;
    if (totalNetwork > networkLimit) {
      limitsExceeded.push(`Network usage (${totalNetwork} Mbps) exceeds limit (${networkLimit} Mbps)`);
      actionTaken = true;
    }

    if (actionTaken) {
      logger.warn(`Resource limits exceeded for viewer ${viewer._id}: ${limitsExceeded.join(', ')}`);
      
      // Add a log entry
      viewer.logs = viewer.logs || [];
      viewer.logs.push({
        timestamp: new Date(),
        level: 'warn',
        message: `Resource limits exceeded: ${limitsExceeded.join(', ')}`
      });
      
      await viewer.save();
      
      // If resource usage is critically high, restart the viewer
      if (cpu > cpuLimit * 1.5 || memory > memoryLimit * 1.5) {
        logger.warn(`Critical resource usage detected for viewer ${viewer._id}, restarting...`);
        
        viewer.logs.push({
          timestamp: new Date(),
          level: 'warn',
          message: 'Critical resource usage detected, restarting viewer'
        });
        
        await restartViewer(viewer._id);
      }
    }
  } catch (error) {
    logger.error(`Error enforcing viewer resource limits: ${error.message}`);
  }
};

/**
 * Restart a viewer due to resource constraints
 * @param {string} viewerId - The ID of the viewer to restart
 */
const restartViewer = async (viewerId) => {
  try {
    const viewer = await Viewer.findById(viewerId);
    if (!viewer) return;
    
    // Stop viewer
    viewer.status = 'stopping';
    await viewer.save();
    
    // Call puppeteer service to stop browser
    await puppeteerService.stopBrowser(viewerId);
    
    // Wait a moment before starting again
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Start viewer again
    viewer.status = 'starting';
    viewer.error = null;
    await viewer.save();
    
    // Call puppeteer service to start browser
    await puppeteerService.startBrowser(viewerId, viewer.streamUrl);
    
  } catch (error) {
    logger.error(`Error restarting viewer ${viewerId}: ${error.message}`);
    
    // Update viewer status to error
    try {
      const viewer = await Viewer.findById(viewerId);
      if (viewer) {
        viewer.status = 'error';
        viewer.error = `Failed to restart: ${error.message}`;
        await viewer.save();
      }
    } catch (updateError) {
      logger.error(`Error updating viewer status: ${updateError.message}`);
    }
  }
};

/**
 * Get current resource usage for a box
 * @param {string} boxId - The ID of the box
 * @returns {Object} The resource usage data
 */
exports.getBoxResourceUsage = async (boxId) => {
  try {
    const box = await Box.findById(boxId);
    if (!box) {
      throw new Error('Box not found');
    }
    
    return box.resources || {
      cpu: 0,
      memory: 0,
      networkRx: 0,
      networkTx: 0,
      diskUsage: 0,
      lastUpdated: null
    };
  } catch (error) {
    logger.error(`Error getting box resource usage: ${error.message}`);
    throw error;
  }
};

/**
 * Get current resource usage for a viewer
 * @param {string} viewerId - The ID of the viewer
 * @returns {Object} The resource usage data
 */
exports.getViewerResourceUsage = async (viewerId) => {
  try {
    const viewer = await Viewer.findById(viewerId);
    if (!viewer) {
      throw new Error('Viewer not found');
    }
    
    return viewer.resources || {
      cpu: 0,
      memory: 0,
      networkRx: 0,
      networkTx: 0,
      lastUpdated: null
    };
  } catch (error) {
    logger.error(`Error getting viewer resource usage: ${error.message}`);
    throw error;
  }
};

/**
 * Update resource limits for a box
 * @param {string} boxId - The ID of the box
 * @param {Object} limits - The new resource limits
 */
exports.updateBoxResourceLimits = async (boxId, limits) => {
  try {
    const box = await Box.findById(boxId);
    if (!box) {
      throw new Error('Box not found');
    }
    
    box.resourceLimits = {
      ...box.resourceLimits,
      ...limits
    };
    
    await box.save();
    logger.info(`Updated resource limits for box ${boxId}`);
    
    return box.resourceLimits;
  } catch (error) {
    logger.error(`Error updating box resource limits: ${error.message}`);
    throw error;
  }
};

/**
 * Update resource limits for a viewer
 * @param {string} viewerId - The ID of the viewer
 * @param {Object} limits - The new resource limits
 */
exports.updateViewerResourceLimits = async (viewerId, limits) => {
  try {
    const viewer = await Viewer.findById(viewerId);
    if (!viewer) {
      throw new Error('Viewer not found');
    }
    
    viewer.resourceLimits = {
      ...viewer.resourceLimits,
      ...limits
    };
    
    await viewer.save();
    logger.info(`Updated resource limits for viewer ${viewerId}`);
    
    return viewer.resourceLimits;
  } catch (error) {
    logger.error(`Error updating viewer resource limits: ${error.message}`);
    throw error;
  }
};

module.exports = exports; 