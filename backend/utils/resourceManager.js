// resourceManager.js
const { performance } = require('perf_hooks');
const puppeteerService = require('../services/puppeteerService');
const Viewer = require('../models/Viewer');
const logger = require('./logger');

/**
 * Resource Manager for efficient memory management and garbage collection
 * This module provides functionality to monitor and manage system resources,
 * particularly for viewers that may be consuming excessive memory or have become idle
 */

// Configuration options with reasonable defaults
const config = {
  // Resource check interval in milliseconds
  checkInterval: 5 * 60 * 1000, // 5 minutes
  
  // Viewer idle timeout in milliseconds (stop viewers inactive for this long)
  idleTimeout: 4 * 60 * 60 * 1000, // 4 hours
  
  // Memory threshold before resource cleanup is triggered
  memoryThresholdMB: 2048, // 2GB
  
  // Maximum allowed memory per viewer in MB
  maxViewerMemoryMB: 300,
  
  // Force GC after this many viewers are stopped
  gcAfterStoppedViewers: 3,
  
  // Enable debug logging
  debug: false
};

// Track resource manager metrics
const metrics = {
  lastCheckTime: null,
  totalChecks: 0,
  totalViewersStopped: 0,
  totalMemoryRecovered: 0,
  viewersStoppedSinceLastGC: 0,
  lastGCTime: null
};

// Store active timers to be able to clean them up
let resourceCheckInterval = null;

/**
 * Initialize the resource manager
 * @param {Object} options - Configuration options to override defaults
 */
function init(options = {}) {
  // Apply any custom configuration
  Object.assign(config, options);
  
  // Start the resource check interval
  if (resourceCheckInterval) {
    clearInterval(resourceCheckInterval);
  }
  
  resourceCheckInterval = setInterval(checkResources, config.checkInterval);
  logger.info(`Resource Manager initialized with ${config.checkInterval/1000}s check interval`);
  
  // Run initial check
  checkResources();
  
  return {
    // Return methods to allow manual control
    checkResources,
    stopIdleViewers,
    getMetrics,
    updateConfig
  };
}

/**
 * Update resource manager configuration
 * @param {Object} options - New configuration options to apply
 */
function updateConfig(options = {}) {
  Object.assign(config, options);
  
  // Restart timer with new interval if it changed
  if (options.checkInterval !== undefined && resourceCheckInterval) {
    clearInterval(resourceCheckInterval);
    resourceCheckInterval = setInterval(checkResources, config.checkInterval);
    logger.info(`Resource Manager check interval updated to ${config.checkInterval/1000}s`);
  }
}

/**
 * Get current resource usage metrics
 * @returns {Object} Current metrics
 */
function getMetrics() {
  return { ...metrics };
}

/**
 * Main resource check function - analyzes memory usage and triggers cleanup if needed
 */
async function checkResources() {
  metrics.lastCheckTime = new Date();
  metrics.totalChecks++;
  
  if (config.debug) {
    logger.debug('Resource Manager: Running resource check');
  }
  
  try {
    // Get memory usage
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const rssMemoryMB = Math.round(memoryUsage.rss / 1024 / 1024);
    
    if (config.debug) {
      logger.debug(`Memory usage - Heap: ${heapUsedMB}MB, RSS: ${rssMemoryMB}MB`);
    }
    
    // Check individual viewer memory usage
    await checkViewerMemoryUsage();
    
    // If we're using too much memory, stop idle viewers to free resources
    if (rssMemoryMB > config.memoryThresholdMB) {
      logger.warn(`Memory threshold exceeded (${rssMemoryMB}MB > ${config.memoryThresholdMB}MB), cleaning up resources`);
      await stopIdleViewers();
    } else {
      // Even if memory is OK, still check for very idle viewers
      await stopIdleViewers(true);
    }
    
    // Request manual garbage collection if enough viewers were stopped
    if (metrics.viewersStoppedSinceLastGC >= config.gcAfterStoppedViewers) {
      requestGarbageCollection();
    }
  } catch (error) {
    logger.error(`Resource Manager error: ${error.message}`);
  }
}

/**
 * Check individual viewer memory usage and stop those consuming too much
 */
async function checkViewerMemoryUsage() {
  try {
    // Get all running viewers
    const browsers = puppeteerService.getBrowserInstances();
    
    if (!browsers || browsers.size === 0) {
      return;
    }
    
    // Check each browser's memory usage
    for (const [viewerId, browserInstance] of browsers.entries()) {
      if (!browserInstance || !browserInstance.browser) continue;
      
      try {
        // For Chromium-based browsers, we can get process info
        if (browserInstance.browser.process()) {
          // This only works if browser was launched not in headless mode or with headless=new
          const pid = browserInstance.browser.process().pid;
          if (pid) {
            // Use process.memoryUsage() as a simpler alternative that works in more environments
            const viewerMemoryMB = Math.round(browserInstance.browser.process().memoryUsage().rss / 1024 / 1024);
            
            if (viewerMemoryMB > config.maxViewerMemoryMB) {
              logger.warn(`Viewer ${viewerId} using excessive memory: ${viewerMemoryMB}MB > ${config.maxViewerMemoryMB}MB`);
              
              // Get viewer details for logging
              const viewer = await Viewer.findById(viewerId);
              if (viewer) {
                // Log the memory issue to the viewer's logs
                viewer.logs.push({
                  level: 'warn',
                  message: `High memory usage detected (${viewerMemoryMB}MB), recycling viewer`
                });
                
                // Stop the viewer to recover memory
                await puppeteerService.stopViewer(viewerId);
                
                // Update metrics
                metrics.totalViewersStopped++;
                metrics.viewersStoppedSinceLastGC++;
                metrics.totalMemoryRecovered += viewerMemoryMB;
                
                logger.info(`Stopped viewer ${viewerId} (${viewer.name}) due to high memory usage`);
              }
            }
          }
        }
      } catch (viewerError) {
        logger.error(`Error checking memory for viewer ${viewerId}: ${viewerError.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error in checkViewerMemoryUsage: ${error.message}`);
  }
}

/**
 * Stop idle viewers to free up resources
 * @param {boolean} onlyCheckVeryIdle - If true, only stop viewers that have been idle for a very long time
 */
async function stopIdleViewers(onlyCheckVeryIdle = false) {
  try {
    // Find idle viewers - viewers that are running but haven't had activity recently
    const idleThreshold = new Date(Date.now() - config.idleTimeout);
    
    // Query to find viewers that should be stopped
    const query = {
      status: 'running',
      lastActivityAt: { $lt: idleThreshold }
    };
    
    // If we only want to check very idle viewers (during routine maintenance)
    // use a longer threshold (2x the normal idle timeout)
    if (onlyCheckVeryIdle) {
      const veryIdleThreshold = new Date(Date.now() - (config.idleTimeout * 2));
      query.lastActivityAt = { $lt: veryIdleThreshold };
    }
    
    const idleViewers = await Viewer.find(query).populate('box');
    
    if (idleViewers.length > 0) {
      logger.info(`Found ${idleViewers.length} idle viewers to clean up`);
      
      for (const viewer of idleViewers) {
        try {
          // Add a log entry to the viewer
          viewer.logs.push({
            level: 'info',
            message: `Auto-stopped due to inactivity (idle for ${Math.round((Date.now() - viewer.lastActivityAt) / 1000 / 60)} minutes)`
          });
          
          // Stop the viewer
          await puppeteerService.stopViewer(viewer._id);
          
          // Update metrics
          metrics.totalViewersStopped++;
          metrics.viewersStoppedSinceLastGC++;
          
          logger.info(`Stopped idle viewer ${viewer._id} (${viewer.name}) - Last active: ${viewer.lastActivityAt}`);
        } catch (viewerError) {
          logger.error(`Failed to stop idle viewer ${viewer._id}: ${viewerError.message}`);
        }
      }
    } else if (config.debug) {
      logger.debug('No idle viewers found to clean up');
    }
  } catch (error) {
    logger.error(`Error in stopIdleViewers: ${error.message}`);
  }
}

/**
 * Request a manual garbage collection via Node.js experimental API
 * This will only work if Node.js is run with --expose-gc flag
 */
function requestGarbageCollection() {
  // Only attempt GC if the exposed global function exists
  if (global.gc) {
    const startTime = performance.now();
    
    try {
      // Run garbage collection
      global.gc();
      
      const duration = Math.round(performance.now() - startTime);
      metrics.lastGCTime = new Date();
      metrics.viewersStoppedSinceLastGC = 0;
      
      logger.info(`Manual garbage collection completed in ${duration}ms`);
    } catch (error) {
      logger.error(`Error during manual garbage collection: ${error.message}`);
    }
  } else if (config.debug) {
    logger.debug('Manual garbage collection not available (start Node with --expose-gc to enable)');
  }
}

/**
 * Clean up resources when shutting down
 */
function shutdown() {
  if (resourceCheckInterval) {
    clearInterval(resourceCheckInterval);
    resourceCheckInterval = null;
  }
  
  logger.info('Resource Manager shut down');
}

// Add shutdown handler
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = {
  init,
  checkResources,
  stopIdleViewers,
  getMetrics,
  updateConfig,
  shutdown
}; 