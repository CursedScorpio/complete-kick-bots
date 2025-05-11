// services/puppeteerService.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AnonymizeUAPlugin = require('puppeteer-extra-plugin-anonymize-ua');
const { v4: uuidv4 } = require('uuid');
const Viewer = require('../models/Viewer');
const Stream = require('../models/Stream');
const Box = require('../models/Box');
const logger = require('../utils/logger');
const config = require('../config/config');
const path = require('path');
const fs = require('fs/promises');

// Import the split modules
const browserUtils = require('./browserUtils');
const kickStreamHandler = require('./kickStreamHandler');

// Add stealth plugin and anonymize UA plugin
puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUAPlugin());

// Map to store browser instances and pages
const browserInstances = new Map();

// Map to store update intervals
const updateIntervals = {};

// Directory for screenshots
const screenshotsDir = path.join(__dirname, '../screenshots');
// Create screenshots directory if it doesn't exist (use sync for startup)
const fsSync = require('fs');
if (!fsSync.existsSync(screenshotsDir)) {
  fsSync.mkdirSync(screenshotsDir, { recursive: true });
}

// Map to store save locks for viewers to prevent concurrent saves
const saveLocks = new Map();

// Track failed attempts to retry with different fingerprints
const failedAttempts = new Map();

/**
 * Save a viewer with locking to prevent parallel saves
 * @param {Object} viewer - Mongoose viewer document
 * @returns {Promise} - Promise that resolves when save is complete
 */
async function saveViewerWithLock(viewer) {
  const viewerId = viewer._id.toString();
  
  // If a save is already in progress for this viewer, wait for it
  if (saveLocks.has(viewerId)) {
    try {
      await saveLocks.get(viewerId);
    } catch (error) {
      // Ignore errors from previous save attempt
      logger.debug(`Previous save for viewer ${viewerId} failed: ${error.message}`);
    }
  }
  
  // Create a new promise for this save operation
  let resolveLock, rejectLock;
  const lockPromise = new Promise((resolve, reject) => {
    resolveLock = resolve;
    rejectLock = reject;
  });
  
  // Set the lock
  saveLocks.set(viewerId, lockPromise);
  
  // Maximum retry attempts and initial delay
  const maxRetries = 5;
  const initialDelay = 200;
  
  try {
    let attempts = 0;
    let lastError = null;
    
    // Retry logic with exponential backoff
    while (attempts < maxRetries) {
      try {
        // Reload the document if this is a retry attempt
        if (attempts > 0) {
          const freshViewer = await Viewer.findById(viewerId);
          if (!freshViewer) {
            throw new Error(`Viewer ${viewerId} not found during retry`);
          }
          
          // Copy only the changed fields to avoid conflicts
          Object.keys(viewer._doc).forEach(key => {
            if (key !== '_id' && key !== '__v' && !key.startsWith('$')) {
              // Special handling for arrays to prevent complete overwrite
              if (Array.isArray(viewer[key]) && Array.isArray(freshViewer[key])) {
                // For the tabs array, merge by index
                if (key === 'tabs' || key === 'tabInfo') {
                  viewer[key].forEach((tab, index) => {
                    if (index < freshViewer[key].length) {
                      Object.assign(freshViewer[key][index], tab);
                    } else {
                      freshViewer[key].push(tab);
                    }
                  });
                } 
                // For activeTabs array, merge unique values
                else if (key === 'activeTabs') {
                  viewer[key].forEach(item => {
                    if (!freshViewer[key].includes(item)) {
                      freshViewer[key].push(item);
                    }
                  });
                }
                // For logs array, append new logs
                else if (key === 'logs') {
                  if (viewer[key].length > freshViewer[key].length) {
                    const newLogs = viewer[key].slice(freshViewer[key].length);
                    freshViewer[key].push(...newLogs);
                    // Cap logs at 100 entries
                    if (freshViewer[key].length > 100) {
                      freshViewer[key] = freshViewer[key].slice(-100);
                    }
                  }
                }
                // For other arrays, prefer the newer array
                else {
                  freshViewer[key] = viewer[key];
                }
              } else {
                // For non-array fields, always use the latest value
                freshViewer[key] = viewer[key];
              }
            }
          });
          
          // Use the fresh document for saving
          viewer = freshViewer;
        }
        
        // Perform the save
        await viewer.save();
        resolveLock();
        return viewer;
      } catch (error) {
        lastError = error;
        
        // Check if this is a concurrent modification error
        if (error.message && (error.message.includes("parallel") || 
                            error.message.includes("version") || 
                            error.message.includes("No matching document found for id"))) {
          // Exponential backoff
          const delay = initialDelay * Math.pow(2, attempts);
          logger.warn(`Concurrent save detected for viewer ${viewerId}, retrying in ${delay}ms (attempt ${attempts + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          attempts++;
        } else {
          // Not a concurrent modification error, rethrow
          throw error;
        }
      }
    }
    
    // If we get here, we've exhausted our retries
    throw lastError || new Error(`Failed to save viewer ${viewerId} after ${maxRetries} attempts`);
  } catch (error) {
    rejectLock(error);
    throw error;
  } finally {
    // Clean up the lock if it's still the current one
    if (saveLocks.get(viewerId) === lockPromise) {
      saveLocks.delete(viewerId);
    }
  }
}

/**
 * Initialize a new tab for a viewer
 * @param {Object} browser - Puppeteer browser instance
 * @param {string} streamUrl - URL of the stream
 * @param {Object} browserFingerprint - Browser fingerprint configuration
 * @param {number} tabIndex - Index of the tab
 * @returns {Promise<Object>} - Page object and initialization status
 */
async function initializeTab(browser, streamUrl, browserFingerprint, tabIndex) {
  // Create a new page (tab)
  const page = await browser.newPage();
  
  // Apply mobile fingerprinting for Kick.com
  await browserUtils.applyMobileFingerprinting(page, browserFingerprint);
  
  // Set up request interception specially tuned for Kick.com
  await kickStreamHandler.setupKickRequestInterception(page);
  
  // Add some random delay to appear more human-like
  const randomDelay = Math.floor(Math.random() * 1000) + 500;
  await page.waitForTimeout(randomDelay);
  
  // Special mobile device settings
  await page.emulate({
    viewport: {
      width: browserFingerprint.screenResolution.width,
      height: browserFingerprint.screenResolution.height,
      deviceScaleFactor: browserFingerprint.isIOS ? 3 : 2.75,
      hasTouch: true,
      isLandscape: browserFingerprint.isLandscape,
      isMobile: true
    },
    userAgent: browserFingerprint.userAgent
  });
  
  try {
    // Navigate to the stream URL
    await page.goto(streamUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // Wait for necessary resources to load
    await page.waitForTimeout(5000);
  } catch (navigationError) {
    logger.warn(`Tab ${tabIndex} navigation had issues: ${navigationError.message}. Continuing anyway...`);
  }
  
  // Handle page barriers (cookie consent, etc.)
  await kickStreamHandler.handleKickPageBarriers(page);
  
  // Kick.com specific video player selectors in priority order
  const kickVideoSelectors = [
    '#video-player',
    '.player-no-controls',
    '.stream-player video',
    '.video-js video',
    '.kick-player video',
    '.channel-live video',
    'video'
  ];
  
  // Try to wait for video player with different selectors
  let videoPlayerFound = false;
  const timeout = config.puppeteer.defaultTimeout || 30000;
  
  for (const selector of kickVideoSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: timeout / kickVideoSelectors.length });
      logger.info(`Tab ${tabIndex}: Video player found with selector "${selector}"`);
      videoPlayerFound = true;
      break;
    } catch (selectorError) {
      logger.debug(`Tab ${tabIndex}: Selector "${selector}" not found, trying next...`);
    }
  }
  
  if (!videoPlayerFound) {
    return { page, success: false, error: 'Video player not found' };
  }
  
  // Ensure the video is playing using touch events for mobile
  await page.evaluate(() => {
    try {
      // Function to create and dispatch touch events
      function createAndDispatchTouchEvent(element, eventType) {
        if (!element) return;
        
        const rect = element.getBoundingClientRect();
        const touchObj = new Touch({
          identifier: Date.now(),
          target: element,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          pageX: rect.left + rect.width / 2,
          pageY: rect.top + rect.height / 2,
          screenX: rect.left + rect.width / 2,
          screenY: rect.top + rect.height / 2,
          radiusX: 2.5,
          radiusY: 2.5,
          rotationAngle: 0,
          force: 1
        });
        
        const touchEvent = new TouchEvent(eventType, {
          cancelable: true,
          bubbles: true,
          touches: (eventType === 'touchend') ? [] : [touchObj],
          targetTouches: (eventType === 'touchend') ? [] : [touchObj],
          changedTouches: [touchObj]
        });
        
        element.dispatchEvent(touchEvent);
      }
      
      // Find Kick.com video player
      const kickVideo = document.querySelector('#video-player');
      if (kickVideo) {
        console.log("Starting Kick.com video playback with mobile optimizations");
        
        // Apply mobile optimizations
        kickVideo.muted = false;
        kickVideo.volume = 0.5;
        kickVideo.controls = true;
        kickVideo.playsInline = true;
        kickVideo.autoplay = true;
        
        // Create mobile touch events
        createAndDispatchTouchEvent(kickVideo, 'touchstart');
        setTimeout(() => {
          createAndDispatchTouchEvent(kickVideo, 'touchend');
          
          // Try to play directly
          kickVideo.play().catch(e => {
            console.warn("Direct play failed, trying muted first:", e);
            
            // If autoplay was blocked, try with muted, then unmute
            kickVideo.muted = true;
            kickVideo.play().then(() => {
              setTimeout(() => {
                kickVideo.muted = false;
                console.log("Unmuted after successful muted play");
              }, 1000);
            }).catch(e2 => console.error("Even muted play failed:", e2));
          });
        }, 100);
      } else {
        // Fallback to generic video
        const videos = document.querySelectorAll('video');
        for (const video of videos) {
          video.muted = false;
          video.volume = 0.5;
          video.controls = true;
          video.playsInLine = true;
          video.autoplay = true;
          
          createAndDispatchTouchEvent(video, 'touchstart');
          setTimeout(() => {
            createAndDispatchTouchEvent(video, 'touchend');
            video.play().catch(e => console.warn("Failed to play video:", e));
          }, 100);
        }
      }
      
      // Also try clicking play buttons
      const playButtons = document.querySelectorAll(
        '.play-button, .vjs-big-play-button, .player-control-playpause, ' + 
        '.player__play-button, [aria-label="Play"], button.play'
      );
      
      for (const button of playButtons) {
        createAndDispatchTouchEvent(button, 'touchstart');
        setTimeout(() => {
          createAndDispatchTouchEvent(button, 'touchend');
        }, 100);
      }
    } catch (e) {
      console.error("Error in mobile video playback:", e);
    }
  });
  
  return { page, success: true };
}

/**
 * Start a viewer with multiple tabs specifically optimized for Kick.com
 * @param {string} viewerId - ID of the viewer
 * @param {number} numTabs - Number of tabs to create (default: 1)
 * @returns {Promise<boolean>} - Success status
 */
async function startViewer(viewerId, numTabs = 1) {
  const viewer = await Viewer.findById(viewerId).populate('box');
  
  if (!viewer) {
    throw new Error('Viewer not found');
  }
  
  if (viewer.box.status !== 'running') {
    throw new Error('Box is not running');
  }
  
  if (!viewer.streamUrl) {
    throw new Error('No stream URL assigned');
  }
  
  if (!viewer.streamUrl.includes('kick.com')) {
    throw new Error('This viewer is optimized for Kick.com streams only');
  }
  
  // Ensure numTabs is at least 1
  numTabs = Math.max(1, parseInt(numTabs) || 1);
  
  logger.info(`Starting Kick.com viewer ${viewer.name} for stream ${viewer.streamUrl} with ${numTabs} tabs`);
  
  // Check if we've had failed attempts with this viewer before
  const attempts = failedAttempts.get(viewerId) || 0;
  
  // Generate a mobile fingerprint for better Kick.com compatibility
  const browserFingerprint = browserUtils.generateMobileFingerprint();
  
  // Update viewer with the fingerprint and tab info
  viewer.browserFingerprint = browserFingerprint;
  viewer.status = 'starting';
  viewer.tabCount = numTabs;
  viewer.activeTabs = [];
  
  // Initialize both tabs and tabInfo arrays
  // The 'tabs' array matches the schema and is used by frontend
  viewer.tabs = Array(numTabs).fill().map((_, index) => ({
    index: index,
    status: 'idle',
    lastScreenshotUrl: null,
    lastScreenshotTimestamp: null,
    playbackStatus: {
      isPlaying: false,
      resolution: null,
      quality: null,
      buffering: false,
      volume: 50
    },
    error: null
  }));
  
  // The 'tabInfo' array is used internally by the puppeteer service
  viewer.tabInfo = Array(numTabs).fill().map((_, index) => ({
    tabIndex: index,
    status: 'starting',
    error: null,
    lastScreenshot: null,
    lastUpdated: new Date()
  }));
  
  await saveViewerWithLock(viewer);
  
  try {
    // Create a new browser instance
    let browser;
    if (attempts > 0) {
      logger.info(`Attempt ${attempts + 1} to start viewer ${viewer.name}, trying random fingerprint`);
      // For retries, use completely random fingerprints
      browser = await browserUtils.launchBrowserWithRandomFingerprint(viewerId);
    } else {
      // First attempt with mobile fingerprint
      browser = await browserUtils.launchBrowserWithFingerprint(viewerId, browserFingerprint);
    }
    
    // Increment failed attempts counter (will be reset on success)
    failedAttempts.set(viewerId, attempts + 1);
    
    // Initialize tabs array
    const pages = new Array(numTabs).fill(undefined);
    
    // Initialize tabs sequentially instead of in parallel
    let successfulTabs = 0;
    for (let i = 0; i < numTabs; i++) {
      try {
        logger.info(`Initializing tab ${i} for viewer ${viewer.name}`);
        const { page, success, error } = await initializeTab(browser, viewer.streamUrl, browserFingerprint, i);
        
        if (success) {
          // Add page event listeners for logging
          page.on('console', async (msg) => {
            const logLevel = msg.type() === 'error' ? 'error' : 
                            msg.type() === 'warning' ? 'warn' : 'debug';
            
            // Log all console messages during debugging
            logger[logLevel](`Tab ${i} Console ${msg.type()} (${viewer.name}): ${msg.text()}`);
            
            // Add critical errors to viewer logs
            if (logLevel === 'error' || (logLevel === 'warn' && msg.text().includes('WebGPU'))) {
              const currentViewer = await Viewer.findById(viewerId);
              currentViewer.logs.push({
                level: logLevel,
                tabIndex: i,
                message: `Tab ${i} Console ${msg.type()}: ${msg.text()}`,
              });
              
              // If too many logs, remove oldest
              if (currentViewer.logs.length > 100) {
                currentViewer.logs = currentViewer.logs.slice(-100);
              }
              
              await saveViewerWithLock(currentViewer);
            }
          });
          
          // Store tab info
          pages[i] = page;
          successfulTabs++;
          
          // Update tab status in the database after each tab initialization
          const updatedViewer = await Viewer.findById(viewerId);
          
          // Update tab info (internal)
          if (updatedViewer.tabInfo && updatedViewer.tabInfo[i]) {
            updatedViewer.tabInfo[i].status = 'running';
            updatedViewer.tabInfo[i].error = null;
            updatedViewer.tabInfo[i].lastUpdated = new Date();
          }
          
          // Update tabs (schema) for frontend
          if (updatedViewer.tabs && updatedViewer.tabs[i]) {
            updatedViewer.tabs[i].status = 'running';
            updatedViewer.tabs[i].error = null;
          }
          
          if (!updatedViewer.activeTabs) {
            updatedViewer.activeTabs = [];
          }
          
          if (!updatedViewer.activeTabs.includes(i)) {
            updatedViewer.activeTabs.push(i);
          }
          
          await saveViewerWithLock(updatedViewer);
        } else {
          logger.error(`Failed to initialize tab ${i} for viewer ${viewer.name}: ${error}`);
          // Update tab status with error
          const updatedViewer = await Viewer.findById(viewerId);
          
          // Update tabInfo (internal)
          if (updatedViewer.tabInfo && updatedViewer.tabInfo[i]) {
            updatedViewer.tabInfo[i].status = 'error';
            updatedViewer.tabInfo[i].error = error || 'Failed to initialize tab';
            updatedViewer.tabInfo[i].lastUpdated = new Date();
          }
          
          // Update tabs (schema) for frontend
          if (updatedViewer.tabs && updatedViewer.tabs[i]) {
            updatedViewer.tabs[i].status = 'error';
            updatedViewer.tabs[i].error = error || 'Failed to initialize tab';
          }
          
          await saveViewerWithLock(updatedViewer);
        }
      } catch (tabError) {
        logger.error(`Error initializing tab ${i} for viewer ${viewer.name}: ${tabError.message}`);
        
        // Update tab info with error
        const updatedViewer = await Viewer.findById(viewerId);
        
        // Update tabInfo (internal)
        if (updatedViewer.tabInfo && updatedViewer.tabInfo[i]) {
          updatedViewer.tabInfo[i].status = 'error';
          updatedViewer.tabInfo[i].error = tabError.message;
          updatedViewer.tabInfo[i].lastUpdated = new Date();
        }
        
        // Update tabs (schema) for frontend
        if (updatedViewer.tabs && updatedViewer.tabs[i]) {
          updatedViewer.tabs[i].status = 'error';
          updatedViewer.tabs[i].error = tabError.message;
        }
        
        await saveViewerWithLock(updatedViewer);
      }
    }
    
    // Store the browser and pages instances
    browserInstances.set(viewerId.toString(), { browser, pages });
    
    // Check stream status and extract metadata
    let isLive = false;
    let streamMetadata = {};
    
    // Use the first successful tab to get stream info
    const firstSuccessfulTab = pages.find(page => page !== undefined);
    if (firstSuccessfulTab) {
      try {
        isLive = await kickStreamHandler.checkKickStreamStatus(firstSuccessfulTab);
        streamMetadata = await kickStreamHandler.extractKickMetadata(firstSuccessfulTab);
      } catch (streamInfoError) {
        logger.warn(`Failed to extract stream info: ${streamInfoError.message}`);
      }
    }
    
    // Update viewer status based on tab initialization results
    const updatedViewer = await Viewer.findById(viewerId);
    if (successfulTabs === 0) {
      throw new Error('All tabs failed to initialize');
    } else if (successfulTabs < numTabs) {
      updatedViewer.status = 'partial';
      updatedViewer.error = `${numTabs - successfulTabs} of ${numTabs} tabs failed to initialize`;
    } else {
      updatedViewer.status = 'running';
      updatedViewer.error = null;
    }
    
    // Update viewer with stream info
    updatedViewer.streamMetadata = streamMetadata;
    updatedViewer.lastActivityAt = new Date();
    await saveViewerWithLock(updatedViewer);
    
    // Start the update interval for this viewer
    startUpdateInterval(viewerId);
    
    // Reset failed attempts counter on success
    if (failedAttempts.has(viewerId)) {
      failedAttempts.delete(viewerId);
    }
    
    // Check if stream exists in database, if not create it
    let stream = await Stream.findOne({ url: updatedViewer.streamUrl });
    if (!stream) {
      stream = new Stream({
        url: updatedViewer.streamUrl,
        streamer: streamMetadata.streamerName || updatedViewer.streamUrl.split('/').pop(),
        title: streamMetadata.title || '',
        game: streamMetadata.game || '',
        viewers: streamMetadata.viewers || 0,
        isLive: isLive,
        activeViewers: [updatedViewer._id],
      });
      await stream.save();
    } else {
      // Update stream info
      stream.title = streamMetadata.title || stream.title;
      stream.game = streamMetadata.game || stream.game;
      stream.viewers = streamMetadata.viewers || stream.viewers;
      stream.isLive = isLive;
      
      // Add this viewer to active viewers if not already added
      if (!stream.activeViewers.includes(updatedViewer._id)) {
        stream.activeViewers.push(updatedViewer._id);
      }
      await stream.save();
    }
    
    logger.info(`Viewer ${updatedViewer.name} started successfully with ${successfulTabs} of ${numTabs} tabs`);
    
    // Take initial screenshots of all tabs one by one (sequentially)
    for (let i = 0; i < pages.length; i++) {
      if (pages[i]) {
        try {
          await takeTabScreenshot(viewerId, i);
          // Add delay between screenshots to prevent MongoDB document conflicts
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (screenshotError) {
          logger.warn(`Failed to take initial screenshot for tab ${i}: ${screenshotError.message}`);
        }
      }
    }
    
    return true;
  } catch (error) {
    logger.error(`Error starting viewer ${viewer.name}: ${error.message}`);
    
    // Update viewer status
    const updatedViewer = await Viewer.findById(viewerId);
    updatedViewer.status = 'error';
    updatedViewer.error = error.message;
    await saveViewerWithLock(updatedViewer);
    
    // Clean up if necessary
    if (browserInstances.has(viewerId.toString())) {
      const { browser } = browserInstances.get(viewerId.toString());
      await browser.close().catch(() => {});
      browserInstances.delete(viewerId.toString());
    }
    
    throw error;
  }
}

/**
 * Stop a viewer
 * @param {string} viewerId - ID of the viewer to stop
 * @returns {Promise<boolean>} - Success status
 */
async function stopViewer(viewerId) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer) {
    throw new Error('Viewer not found');
  }
  
  logger.info(`Stopping viewer ${viewer.name} with ${viewer.tabCount || 1} tabs`);
  
  try {
    // Clear the update interval
    clearUpdateInterval(viewerId);
    
    // Close the browser instance if it exists
    if (browserInstances.has(viewerId.toString())) {
      const { browser } = browserInstances.get(viewerId.toString());
      await browser.close().catch(() => {});
      browserInstances.delete(viewerId.toString());
    }
    
    // Update viewer status
    viewer.status = 'idle';
    viewer.error = null;
    viewer.activeTabs = [];
    viewer.tabInfo = [];
    
    // Reset tab-specific fields
    viewer.playbackStatus = {
      isPlaying: false,
      isPaused: false,
      isBuffering: false,
      isMuted: false,
      volume: 0,
      quality: '',
      error: null
    };
    await saveViewerWithLock(viewer);
    
    // Remove from active viewers in stream
    if (viewer.streamUrl) {
      await Stream.updateOne(
        { url: viewer.streamUrl },
        { $pull: { activeViewers: viewer._id } }
      );
    }
    
    logger.info(`Viewer ${viewer.name} stopped successfully`);
    
    return true;
  } catch (error) {
    logger.error(`Error stopping viewer ${viewer.name}: ${error.message}`);
    
    // Update viewer error
    viewer.status = 'error';
    viewer.error = error.message;
    await saveViewerWithLock(viewer);
    
    throw error;
  }
}

/**
 * Take a screenshot of a specific tab
 * @param {string} viewerId - ID of the viewer
 * @param {number} tabIndex - Index of the tab
 * @returns {Promise<string>} - Path to the screenshot
 */
async function takeTabScreenshot(viewerId, tabIndex) {
  let viewer = await Viewer.findById(viewerId);
  
  if (!viewer) {
    throw new Error('Viewer not found');
  }
  
  if (viewer.status !== 'running' && viewer.status !== 'partial') {
    throw new Error('Viewer is not running');
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    throw new Error('Browser instance not found');
  }
  
  const { pages } = browserInstances.get(viewerId.toString());
  
  if (!pages[tabIndex]) {
    throw new Error(`Tab ${tabIndex} not found`);
  }
  
  logger.info(`Taking screenshot for viewer ${viewer.name}, tab ${tabIndex}`);
  
  const screenshotDir = path.join(process.cwd(), 'screenshots');
  const viewerDir = path.join(screenshotDir, viewerId);
  
  // Create directories if they don't exist
  try {
    // Create directories with recursive option
    await fs.mkdir(screenshotDir, { recursive: true });
    await fs.mkdir(viewerDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `tab-${tabIndex}-${timestamp}.png`;
    const screenshotPath = path.join(viewerDir, filename);
    
    // Check if we can access the page DOM
    await pages[tabIndex].evaluate(() => document.body.innerHTML);
    
    // Ensure at least 1 second since the last screenshot to avoid spamming
    const lastScreenshotTime = viewer.tabInfo && viewer.tabInfo[tabIndex] && viewer.tabInfo[tabIndex].lastUpdated;
    if (lastScreenshotTime) {
      const timeSinceLastScreenshot = new Date() - new Date(lastScreenshotTime);
      if (timeSinceLastScreenshot < 1000) {
        await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastScreenshot));
      }
    }
    
    // Get stream playback status
    let playbackStatus;
    try {
      playbackStatus = await kickStreamHandler.extractKickPlaybackStatus(pages[tabIndex]);
    } catch (playbackError) {
      logger.warn(`Error getting playback status for tab ${tabIndex}: ${playbackError.message}`);
      playbackStatus = { error: playbackError.message };
    }
    
    // Take the screenshot
    await pages[tabIndex].screenshot({
      path: screenshotPath,
      type: 'png',
      fullPage: false,
      clip: {
        x: 0,
        y: 0,
        width: pages[tabIndex].viewport().width,
        height: pages[tabIndex].viewport().height
      }
    });
    
    // Get the public URL for the screenshot
    const publicUrl = `/api/viewers/screenshots/${viewerId}/${filename}`;
    
    // Update the viewer with the screenshot info
    viewer = await Viewer.findById(viewerId);
    
    // Update internal tabInfo
    if (!viewer.tabInfo) {
      viewer.tabInfo = [];
    }
    
    if (!viewer.tabInfo[tabIndex]) {
      viewer.tabInfo[tabIndex] = {
        tabIndex,
        status: 'running',
        error: null
      };
    }
    
    viewer.tabInfo[tabIndex].lastScreenshot = publicUrl;
    viewer.tabInfo[tabIndex].lastUpdated = new Date();
    
    // Update main schema tabs
    if (!viewer.tabs) {
      viewer.tabs = [];
    }
    
    if (!viewer.tabs[tabIndex]) {
      viewer.tabs[tabIndex] = {
        index: tabIndex,
        status: 'running',
        error: null
      };
    }
    
    viewer.tabs[tabIndex].lastScreenshotUrl = publicUrl;
    viewer.tabs[tabIndex].lastScreenshotTimestamp = new Date();
    
    // Update playback status if available
    if (playbackStatus) {
      // For internal tabInfo
      viewer.tabInfo[tabIndex].playbackStatus = playbackStatus;
      
      // For schema tabs array used by frontend
      viewer.tabs[tabIndex].playbackStatus = {
        isPlaying: playbackStatus.isPlaying || false,
        resolution: playbackStatus.resolution || null,
        quality: playbackStatus.quality || null,
        buffering: playbackStatus.isBuffering || false,
        volume: playbackStatus.volume || 50
      };
    }
    
    // Also update the main viewer's screenshot info if this is tab 0
    if (tabIndex === 0) {
      viewer.lastScreenshotUrl = publicUrl;
      viewer.lastScreenshotTimestamp = new Date();
      viewer.playbackStatus = viewer.tabs[0].playbackStatus;
    }
    
    // Update the lastActivityAt field
    viewer.lastActivityAt = new Date();
    
    await saveViewerWithLock(viewer);
    
    return publicUrl;
  } catch (error) {
    logger.error(`Error taking screenshot for tab ${tabIndex}: ${error.message}`);
    
    // Try to update the viewer with the error
    try {
      const currentViewer = await Viewer.findById(viewerId);
      
      // Update internal tabInfo
      if (currentViewer.tabInfo && currentViewer.tabInfo[tabIndex]) {
        currentViewer.tabInfo[tabIndex].error = error.message;
        currentViewer.tabInfo[tabIndex].lastUpdated = new Date();
      }
      
      // Update schema tabs for frontend
      if (currentViewer.tabs && currentViewer.tabs[tabIndex]) {
        currentViewer.tabs[tabIndex].error = error.message;
      }
      
      await saveViewerWithLock(currentViewer);
    } catch (updateError) {
      logger.error(`Failed to update viewer with screenshot error: ${updateError.message}`);
    }
    
    throw error;
  }
}

/**
 * Take a screenshot of all tabs for a viewer
 * @param {string} viewerId - ID of the viewer
 * @returns {Promise<Array<string>>} - Array of paths to the screenshots
 */
async function takeAllTabsScreenshots(viewerId) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer) {
    throw new Error('Viewer not found');
  }
  
  if (viewer.status !== 'running' && viewer.status !== 'partial') {
    throw new Error('Viewer is not running');
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    throw new Error('Browser instance not found');
  }
  
  const { pages } = browserInstances.get(viewerId.toString());
  
  logger.info(`Taking screenshots for all tabs of viewer ${viewer.name}`);
  
  const screenshotPromises = [];
  const results = [];
  
  // Take screenshots of all active tabs
  for (let i = 0; i < pages.length; i++) {
    if (pages[i]) {
      screenshotPromises.push((async (tabIndex) => {
        try {
          const path = await takeTabScreenshot(viewerId, tabIndex);
          return { tabIndex, path, success: true };
        } catch (error) {
          logger.error(`Error taking screenshot for tab ${tabIndex}: ${error.message}`);
          return { tabIndex, error: error.message, success: false };
        }
      })(i));
    }
  }
  
  // Wait for all screenshots to finish
  const screenshotResults = await Promise.all(screenshotPromises);
  
  // Update the viewer with the results
  viewer.lastActivityAt = new Date();
  await saveViewerWithLock(viewer);
  
  return screenshotResults.filter(result => result.success).map(result => result.path);
}

/**
 * Start update interval for a viewer
 * @param {string} viewerId - ID of the viewer
 */
function startUpdateInterval(viewerId) {
  // Clear any existing interval
  clearUpdateInterval(viewerId);
  
  // Create a new interval
  updateIntervals[viewerId] = setInterval(async () => {
    try {
      await updateViewerTabs(viewerId);
    } catch (error) {
      logger.error(`Error updating viewer ${viewerId} tabs: ${error.message}`);
    }
  }, config.viewer.updateInterval || 15000); // Shorter interval for mobile streams
}

/**
 * Clear update interval for a viewer
 * @param {string} viewerId - ID of the viewer
 */
function clearUpdateInterval(viewerId) {
  if (updateIntervals[viewerId]) {
    clearInterval(updateIntervals[viewerId]);
    delete updateIntervals[viewerId];
  }
}

/**
 * Update all tabs for a viewer
 * @param {string} viewerId - ID of the viewer
 */
async function updateViewerTabs(viewerId) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer || (viewer.status !== 'running' && viewer.status !== 'partial')) {
    return;
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    return;
  }
  
  const { pages } = browserInstances.get(viewerId.toString());
  
  // Update analytics for all tabs
  const tabUpdatePromises = [];
  
  for (let i = 0; i < pages.length; i++) {
    if (pages[i]) {
      tabUpdatePromises.push(updateTabData(viewerId, i));
    }
  }
  
  // Wait for all tab updates to complete
  await Promise.all(tabUpdatePromises);
  
  // Update the main viewer
  try {
    // Use the first active tab to get stream info
    const firstActiveTabIndex = viewer.activeTabs[0] || 0;
    const firstActivePage = pages[firstActiveTabIndex];
    
    if (firstActivePage) {
      // Extract stream metadata
      const isLive = await kickStreamHandler.checkKickStreamStatus(firstActivePage);
      const streamMetadata = await kickStreamHandler.extractKickMetadata(firstActivePage);
      
      // Extract chat messages if this viewer has chat parsing enabled
      if (viewer.isParseChatEnabled) {
        try {
          const chatMessages = await kickStreamHandler.extractKickChatMessages(firstActivePage);
          
          // Update stream with chat messages
          if (chatMessages && chatMessages.length > 0) {
            await Stream.updateOne(
              { url: viewer.streamUrl },
              { 
                $push: { 
                  chatMessages: {
                    $each: chatMessages.map(msg => ({
                      ...msg,
                      viewerId: viewer._id
                    })),
                    $slice: -1000 // Keep the most recent 1000 messages
                  }
                },
                title: streamMetadata.title || undefined,
                game: streamMetadata.game || undefined,
                viewers: streamMetadata.viewers || undefined,
                isLive: isLive,
                lastUpdated: new Date()
              }
            );
          }
        } catch (chatError) {
          logger.debug(`Error extracting chat: ${chatError.message}`);
        }
      }
      
      // Update stream data if it has changed
      if (streamMetadata.title || streamMetadata.game || streamMetadata.viewers) {
        await Stream.updateOne(
          { url: viewer.streamUrl },
          {
            $set: {
              title: streamMetadata.title || undefined,
              game: streamMetadata.game || undefined,
              viewers: streamMetadata.viewers || undefined,
              isLive: isLive,
              lastUpdated: new Date()
            }
          }
        );
      }
      
      // Update viewer stream metadata
      viewer.streamMetadata = {
        ...viewer.streamMetadata,
        ...streamMetadata,
        isLive
      };
    }
    
    // Update viewer
    viewer.lastActivityAt = new Date();
    viewer.updateCount = (viewer.updateCount || 0) + 1;
    await saveViewerWithLock(viewer);
  } catch (error) {
    logger.error(`Error updating viewer ${viewer.name} metadata: ${error.message}`);
    
    // Add to viewer logs
    viewer.logs.push({
      level: 'error',
      message: `Metadata update error: ${error.message}`,
    });
    
    // If too many logs, remove oldest
    if (viewer.logs.length > 100) {
      viewer.logs = viewer.logs.slice(-100);
    }
    
    await saveViewerWithLock(viewer);
  }
}

/**
 * Update data for a specific tab
 * @param {string} viewerId - ID of the viewer
 * @param {number} tabIndex - Index of the tab
 */
async function updateTabData(viewerId, tabIndex) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer || (viewer.status !== 'running' && viewer.status !== 'partial')) {
    return;
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    return;
  }
  
  const { pages } = browserInstances.get(viewerId.toString());
  
  if (!pages[tabIndex]) {
    if (viewer.tabInfo && viewer.tabInfo[tabIndex]) {
      viewer.tabInfo[tabIndex].status = 'error';
      viewer.tabInfo[tabIndex].error = 'Tab no longer exists';
      viewer.tabInfo[tabIndex].lastUpdated = new Date();
      await saveViewerWithLock(viewer);
    }
    return;
  }
  
  const page = pages[tabIndex];
  
  try {
    // For Kick.com mobile, perform more frequent interactions to keep stream active
    if (Math.random() < 0.6) { // 60% chance of interaction
      await kickStreamHandler.simulateMobileInteraction(page);
    }
    
    // Ensure video is playing by directly interacting with Kick.com player
    await page.evaluate(() => {
      try {
        // Function to create touch events (important for mobile)
        function createAndDispatchTouchEvent(element, eventType) {
          if (!element) return;
          
          const rect = element.getBoundingClientRect();
          const touchObj = new Touch({
            identifier: Date.now(),
            target: element,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            pageX: rect.left + rect.width / 2,
            pageY: rect.top + rect.height / 2,
            screenX: rect.left + rect.width / 2,
            screenY: rect.top + rect.height / 2,
            radiusX: 2.5,
            radiusY: 2.5,
            rotationAngle: 0,
            force: 1
          });
          
          const touchEvent = new TouchEvent(eventType, {
            cancelable: true,
            bubbles: true,
            touches: (eventType === 'touchend') ? [] : [touchObj],
            targetTouches: (eventType === 'touchend') ? [] : [touchObj],
            changedTouches: [touchObj]
          });
          
          element.dispatchEvent(touchEvent);
        }
        
        // Check for Kick.com specific video player
        const kickPlayer = document.querySelector('#video-player');
        if (kickPlayer) {
          // Ping the player with a touch event to keep it active
          createAndDispatchTouchEvent(kickPlayer, 'touchstart');
          setTimeout(() => {
            createAndDispatchTouchEvent(kickPlayer, 'touchend');
          }, 50);
          
          // Ensure playback is active
          if (kickPlayer.paused) {
            console.log("Restarting paused Kick player");
            kickPlayer.play().catch(e => console.error('Error playing video:', e));
          }
          
          // Ensure not muted
          if (kickPlayer.muted) {
            kickPlayer.muted = false;
          }
          
          // Set reasonable volume
          kickPlayer.volume = 0.5;
        } else {
          // Fallback to generic video element
          const video = document.querySelector('video');
          if (video) {
            // Touch the video
            createAndDispatchTouchEvent(video, 'touchstart');
            setTimeout(() => {
              createAndDispatchTouchEvent(video, 'touchend');
            }, 50);
            
            if (video.paused) {
              video.play().catch(e => console.error('Error playing video:', e));
            }
            if (video.muted) {
              video.muted = false;
              video.volume = 0.5;
            }
          }
        }
        
        // Check for error overlays and dismiss them
        const errorOverlays = document.querySelectorAll('.player-error, .error-message, .player-error-overlay');
        for (const overlay of errorOverlays) {
          // Try to make it invisible
          overlay.style.display = 'none';
          
          // Try finding any buttons to dismiss the error
          const buttons = overlay.querySelectorAll('button');
          for (const button of buttons) {
            createAndDispatchTouchEvent(button, 'touchstart');
            setTimeout(() => {
              createAndDispatchTouchEvent(button, 'touchend');
            }, 50);
          }
        }
      } catch (e) {
        console.error('Error ensuring video playback:', e);
      }
    });
    
    // Extract playback status
    const playbackStatus = await kickStreamHandler.extractKickPlaybackStatus(page);
    
    // Take a screenshot periodically (every 15th update)
    const viewerUpdateCount = viewer.updateCount || 0;
    if (viewerUpdateCount % 15 === 0) {
      try {
        await takeTabScreenshot(viewerId, tabIndex);
      } catch (screenshotError) {
        logger.debug(`Failed to take periodic screenshot for tab ${tabIndex}: ${screenshotError.message}`);
      }
    }
    
    // Update tab info in viewer
    if (viewer.tabInfo && viewer.tabInfo[tabIndex]) {
      viewer.tabInfo[tabIndex].status = playbackStatus.isPlaying ? 'playing' : 
                                        playbackStatus.isPaused ? 'paused' : 
                                        playbackStatus.isBuffering ? 'buffering' : 'error';
      viewer.tabInfo[tabIndex].error = playbackStatus.error;
      viewer.tabInfo[tabIndex].lastUpdated = new Date();
      viewer.tabInfo[tabIndex].playbackStatus = playbackStatus;
    }
    
    // Use first tab's playback status for main viewer object (for backward compatibility)
    if (tabIndex === 0) {
      viewer.playbackStatus = playbackStatus;
    }
    
    await saveViewerWithLock(viewer);
    
    // For Kick.com, handle stream issues more aggressively
    if (!playbackStatus.isPlaying || playbackStatus.isBuffering || playbackStatus.error) {
      logger.warn(`Tab ${tabIndex} stream issues detected for viewer ${viewer.name}: isPlaying=${playbackStatus.isPlaying}, isBuffering=${playbackStatus.isBuffering}, error=${playbackStatus.error}`);
      
      // Add to viewer logs
      viewer.logs.push({
        level: 'warn',
        tabIndex,
        message: `Tab ${tabIndex} stream issues: ${playbackStatus.error || 'Playback problem'}`,
      });
      
      // If too many logs, remove oldest
      if (viewer.logs.length > 100) {
        viewer.logs = viewer.logs.slice(-100);
      }
      
      await saveViewerWithLock(viewer);
      
      // Try to recover the tab
      await forceRefreshTab(viewerId, tabIndex);
    }
  } catch (error) {
    logger.error(`Error updating data for viewer ${viewer.name}, tab ${tabIndex}: ${error.message}`);
    
    // Add to viewer logs
    viewer.logs.push({
      level: 'error',
      tabIndex,
      message: `Tab ${tabIndex} update error: ${error.message}`,
    });
    
    // If too many logs, remove oldest
    if (viewer.logs.length > 100) {
      viewer.logs = viewer.logs.slice(-100);
    }
    
    // Update tab status
    if (viewer.tabInfo && viewer.tabInfo[tabIndex]) {
      viewer.tabInfo[tabIndex].status = 'error';
      viewer.tabInfo[tabIndex].error = error.message;
      viewer.tabInfo[tabIndex].lastUpdated = new Date();
    }
    
    await saveViewerWithLock(viewer);
  }
}

/**
 * Force refresh a specific tab
 * @param {string} viewerId - ID of the viewer
 * @param {number} tabIndex - Index of the tab
 * @returns {Promise<boolean>} - Success status
 */
async function forceRefreshTab(viewerId, tabIndex) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer) {
    throw new Error('Viewer not found');
  }
  
  if (viewer.status !== 'running' && viewer.status !== 'partial') {
    throw new Error('Viewer is not running');
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    throw new Error('Browser instance not found');
  }
  
  const { pages } = browserInstances.get(viewerId.toString());
  
  if (!pages[tabIndex]) {
    throw new Error(`Tab ${tabIndex} not found`);
  }
  
  logger.info(`Forcing refresh for tab ${tabIndex} of viewer ${viewer.name}`);
  
  try {
    const page = pages[tabIndex];
    
    // Update tab status
    if (viewer.tabInfo && viewer.tabInfo[tabIndex]) {
      viewer.tabInfo[tabIndex].status = 'refreshing';
      viewer.tabInfo[tabIndex].lastUpdated = new Date();
    }
    await saveViewerWithLock(viewer);
    
    // Remember the current URL
    const currentUrl = page.url();
    
    // Navigate away to a blank page first (helps clear state)
    await page.goto('about:blank', { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    
    // Now navigate back to the stream with a fresh load
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    
    // Handle page barriers and ensure playback
    await kickStreamHandler.handleKickPageBarriers(page);
    
    // Check if stream is now playing
    const playbackStatus = await kickStreamHandler.extractKickPlaybackStatus(page);
    
    // Update tab info
    if (viewer.tabInfo && viewer.tabInfo[tabIndex]) {
      viewer.tabInfo[tabIndex].status = playbackStatus.isPlaying ? 'playing' : 
                                        playbackStatus.isPaused ? 'paused' : 
                                        playbackStatus.isBuffering ? 'buffering' : 'error';
      viewer.tabInfo[tabIndex].error = playbackStatus.error;
      viewer.tabInfo[tabIndex].lastUpdated = new Date();
      viewer.tabInfo[tabIndex].playbackStatus = playbackStatus;
    }
    
    // Update the main viewer
    viewer.lastActivityAt = new Date();
    
    // If this is the first tab, update the main playbackStatus for backward compatibility
    if (tabIndex === 0) {
      viewer.playbackStatus = playbackStatus;
    }
    
    await saveViewerWithLock(viewer);
    
    logger.info(`Force refresh completed for tab ${tabIndex} of viewer ${viewer.name}`);
    
    // Take a screenshot to confirm state
    try {
      await takeTabScreenshot(viewerId, tabIndex);
    } catch (screenshotError) {
      logger.debug(`Failed to take post-refresh screenshot for tab ${tabIndex}: ${screenshotError.message}`);
    }
    
    return playbackStatus.isPlaying;
  } catch (error) {
    logger.error(`Error during force refresh for tab ${tabIndex} of viewer ${viewer.name}: ${error.message}`);
    
    // Update tab status
    if (viewer.tabInfo && viewer.tabInfo[tabIndex]) {
      viewer.tabInfo[tabIndex].status = 'error';
      viewer.tabInfo[tabIndex].error = `Force refresh failed: ${error.message}`;
      viewer.tabInfo[tabIndex].lastUpdated = new Date();
    }
    await saveViewerWithLock(viewer);
    
    throw error;
  }
}

/**
 * Force all tabs of a viewer to use lowest quality (160p)
 * @param {string} viewerId - ID of the viewer
 * @returns {Promise<{success: boolean, total: number, successful: number, failed: number, errors: Array}>} - Operation results
 */
async function forceViewerLowestQuality(viewerId) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer) {
    throw new Error('Viewer not found');
  }
  
  if (viewer.status !== 'running' && viewer.status !== 'partial') {
    throw new Error('Viewer is not running');
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    throw new Error('Browser instance not found');
  }
  
  const { pages } = browserInstances.get(viewerId.toString());
  
  const results = {
    success: true,
    total: pages.filter(p => p !== undefined).length,
    successful: 0,
    failed: 0,
    errors: []
  };
  
  logger.info(`Setting lowest quality (160p) for all tabs of viewer ${viewer.name}`);
  
  for (let i = 0; i < pages.length; i++) {
    if (!pages[i]) continue;
    
    try {
      await forceTabLowestQuality(viewerId, i);
      results.successful++;
      
      // Add a small delay between operations to avoid overloading
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      logger.error(`Failed to set lowest quality for tab ${i} of viewer ${viewer.name}: ${error.message}`);
      results.failed++;
      results.errors.push({
        tabIndex: i,
        error: error.message
      });
    }
  }
  
  // Mark overall success as false if any operations failed
  if (results.failed > 0) {
    results.success = false;
  }
  
  logger.info(`Lowest quality set results for viewer ${viewer.name}: ${results.successful} successful, ${results.failed} failed`);
  
  return results;
}

/**
 * Force a specific tab to use lowest quality (160p)
 * @param {string} viewerId - ID of the viewer
 * @param {number} tabIndex - Index of the tab
 * @returns {Promise<boolean>} - Success status
 */
async function forceTabLowestQuality(viewerId, tabIndex) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer) {
    throw new Error('Viewer not found');
  }
  
  if (viewer.status !== 'running' && viewer.status !== 'partial') {
    throw new Error('Viewer is not running');
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    throw new Error('Browser instance not found');
  }
  
  const { pages } = browserInstances.get(viewerId.toString());
  
  if (!pages[tabIndex]) {
    throw new Error(`Tab ${tabIndex} not found`);
  }
  
  logger.info(`Setting lowest quality (160p) for tab ${tabIndex} of viewer ${viewer.name}`);
  
  try {
    const page = pages[tabIndex];
    
    // First, ensure control overlay is visible by clicking on video
    await page.evaluate(() => {
      const video = document.querySelector('#video-player') || document.querySelector('video');
      if (video) {
        video.click();
        console.log("Clicked on video to show controls");
      }
    });
    
    // Wait for controls to appear
    await page.waitForTimeout(1000);
    
    // Log all visible buttons for debugging
    const buttonsInfo = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.map(btn => ({
        svg: btn.querySelector('svg') ? true : false,
        path: btn.querySelector('svg path') ? btn.querySelector('svg path').getAttribute('d') : null,
        classes: btn.className,
        visible: btn.offsetParent !== null
      }));
    });
    console.log("Buttons found:", JSON.stringify(buttonsInfo));
    
    // Click on the settings button - using the specific SVG path pattern
    const clicked = await page.evaluate(() => {
      // Find the settings button with the specific gear icon SVG path 
      // This matches the gear icon in your HTML
      const settingsButton = Array.from(document.querySelectorAll('button')).find(btn => {
        const svg = btn.querySelector('svg');
        const path = svg && svg.querySelector('path');
        return path && path.getAttribute('d').includes('M16,20.9c-2.7,0-4.9-2.2-4.9-4.9s2.2-4.9,4.9-4.9');
      });
      
      if (settingsButton) {
        console.log("Found settings button, clicking it");
        settingsButton.click();
        return true;
      } else {
        console.error("Settings button with gear icon not found");
        
        // Try alternative approach - any button in the controls area that might be settings
        const controlsArea = document.querySelector('.z-controls');
        if (controlsArea) {
          const lastButton = controlsArea.querySelectorAll('button')[controlsArea.querySelectorAll('button').length - 1];
          if (lastButton) {
            console.log("Trying last button in controls area");
            lastButton.click();
            return true;
          }
        }
        return false;
      }
    });
    
    if (!clicked) {
      logger.warn(`Could not find settings button for tab ${tabIndex}`);
    }
    
    // Wait for quality menu to appear
    await page.waitForTimeout(2000);
    
    // Now click the 160p option
    const qualityChanged = await page.evaluate(() => {
      // Look for the exact 160p button structure from your HTML
      const option160p = document.querySelector('[role="radio"][value="160p"], #160p');
      
      if (option160p) {
        console.log("Found 160p option, clicking it");
        option160p.click();
        return true;
      }
      
      // Alternative: Look for any quality option with "160p" text
      const allQualityOptions = Array.from(document.querySelectorAll('[role="radio"], [role="menuitemradio"]'));
      console.log(`Found ${allQualityOptions.length} quality options`);
      
      const option160Text = allQualityOptions.find(opt => 
        opt.textContent.includes('160p') || 
        opt.nextElementSibling?.textContent.includes('160p')
      );
      
      if (option160Text) {
        console.log("Found 160p text option, clicking it");
        option160Text.click();
        return true;
      }
      
      // Last attempt - find anything with 160p label
      const qualityLabels = Array.from(document.querySelectorAll('label'));
      const label160p = qualityLabels.find(label => label.textContent.includes('160p'));
      
      if (label160p) {
        console.log("Found 160p label, clicking preceding button");
        const buttonFor160p = label160p.previousElementSibling;
        if (buttonFor160p) {
          buttonFor160p.click();
          return true;
        }
      }
      
      console.error("Could not find 160p quality option");
      return false;
    });
    
    // Update viewer with quality change attempt
    viewer.lastActivityAt = new Date();
    
    // Add log entry
    viewer.logs.push({
      level: 'info',
      tabIndex,
      message: `Tab ${tabIndex}: Attempted to set quality to 160p: ${qualityChanged ? 'Success' : 'Failed'}`,
      details: clicked ? 'Settings button clicked' : 'Settings button not found'
    });
    
    // If too many logs, remove oldest
    if (viewer.logs.length > 100) {
      viewer.logs = viewer.logs.slice(-100);
    }
    
    // Update tab info
    if (viewer.tabInfo && viewer.tabInfo[tabIndex]) {
      viewer.tabInfo[tabIndex].lastUpdated = new Date();
    }
    
    await saveViewerWithLock(viewer);
    
    // Take a screenshot to confirm
    try {
      await takeTabScreenshot(viewerId, tabIndex);
    } catch (error) {
      logger.debug(`Failed to take post-quality-change screenshot for tab ${tabIndex}: ${error.message}`);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error setting lowest quality for tab ${tabIndex} of viewer ${viewer.name}: ${error.message}`);
    throw error;
  }
}

/**
 * Force all running viewers to use lowest quality (160p)
 * @returns {Promise<{success: boolean, total: number, successful: number, failed: number, errors: Array}>} - Operation results
 */
async function forceAllViewersLowestQuality() {
  const viewers = await Viewer.find({ status: 'running' });
  const results = {
    success: true,
    total: viewers.length,
    successful: 0,
    failed: 0,
    errors: []
  };
  
  logger.info(`Attempting to set lowest quality (160p) for ${viewers.length} viewers`);
  
  for (const viewer of viewers) {
    try {
      const viewerResults = await forceViewerLowestQuality(viewer._id);
      
      if (viewerResults.success) {
        results.successful++;
      } else {
        results.failed++;
        results.errors.push({
          viewerId: viewer._id,
          viewerName: viewer.name,
          tabResults: viewerResults
        });
      }
      
      // Add a small delay between viewers to avoid overloading
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      logger.error(`Failed to set lowest quality for viewer ${viewer.name}: ${error.message}`);
      results.failed++;
      results.errors.push({
        viewerId: viewer._id,
        viewerName: viewer.name,
        error: error.message
      });
    }
  }
  
  // Mark overall success as false if any operations failed
  if (results.failed > 0) {
    results.success = false;
  }
  
  logger.info(`Lowest quality set results: ${results.successful} successful, ${results.failed} failed`);
  
  return results;
}

/**
 * Add a new tab to an existing viewer
 * @param {string} viewerId - ID of the viewer
 * @returns {Promise<number>} - Index of the new tab
 */
async function addViewerTab(viewerId) {
  let viewer = await Viewer.findById(viewerId);
  
  if (!viewer) {
    throw new Error('Viewer not found');
  }
  
  if (viewer.status !== 'running' && viewer.status !== 'partial') {
    throw new Error('Viewer is not running');
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    throw new Error('Browser instance not found');
  }
  
  // Check if we've reached the maximum number of tabs
  if (viewer.tabs && viewer.tabs.length >= viewer.maxTabs) {
    throw new Error(`Cannot add more tabs. Maximum of ${viewer.maxTabs} tabs allowed.`);
  }
  
  logger.info(`Adding a new tab for viewer ${viewer.name}`);
  
  try {
    const { browser, pages } = browserInstances.get(viewerId.toString());
    
    // Find the next available tab index
    const newTabIndex = pages.length;
    
    // Initialize the new tab
    const { page, success, error } = await initializeTab(
      browser, 
      viewer.streamUrl, 
      viewer.browserFingerprint, 
      newTabIndex
    );
    
    if (!success) {
      throw new Error(`Failed to initialize new tab: ${error}`);
    }
    
    // Add event listeners for logging
    page.on('console', async (msg) => {
      const logLevel = msg.type() === 'error' ? 'error' : 
                      msg.type() === 'warning' ? 'warn' : 'debug';
      
      // Log all console messages during debugging
      logger[logLevel](`Tab ${newTabIndex} Console ${msg.type()} (${viewer.name}): ${msg.text()}`);
      
      // Add critical errors to viewer logs
      if (logLevel === 'error' || (logLevel === 'warn' && msg.text().includes('WebGPU'))) {
        // Get a fresh copy of the viewer to avoid concurrent modification
        const currentViewer = await Viewer.findById(viewerId);
        if (currentViewer) {
          currentViewer.logs.push({
            level: logLevel,
            tabIndex: newTabIndex,
            message: `Tab ${newTabIndex} Console ${msg.type()}: ${msg.text()}`,
          });
          
          // If too many logs, remove oldest
          if (currentViewer.logs.length > 100) {
            currentViewer.logs = currentViewer.logs.slice(-100);
          }
          
          await saveViewerWithLock(currentViewer);
        }
      }
    });
    
    // Add the new page to the pages array
    pages.push(page);
    
    // Update browser instances
    browserInstances.set(viewerId.toString(), { browser, pages });
    
    // Get a fresh copy of the viewer to avoid concurrent modification
    viewer = await Viewer.findById(viewerId);
    if (!viewer) {
      throw new Error('Viewer not found after tab initialization');
    }
    
    // Update viewer with new tab info for internal use
    if (!viewer.tabInfo) {
      viewer.tabInfo = [];
    }
    
    // Add new tab info for internal use
    viewer.tabInfo.push({
      tabIndex: newTabIndex,
      status: 'running',
      error: null,
      lastScreenshot: null,
      lastUpdated: new Date()
    });
    
    // Update schema tabs array for frontend
    if (!viewer.tabs) {
      viewer.tabs = [];
    }
    
    // Add tab for frontend use
    viewer.tabs.push({
      index: newTabIndex,
      status: 'running',
      lastScreenshotUrl: null,
      lastScreenshotTimestamp: null,
      playbackStatus: {
        isPlaying: false,
        resolution: null,
        quality: null,
        buffering: false,
        volume: 50
      },
      error: null
    });
    
    // Update tab count and active tabs
    viewer.tabCount = (viewer.tabCount || 1) + 1;
    if (!viewer.activeTabs) {
      viewer.activeTabs = [];
    }
    viewer.activeTabs.push(newTabIndex);
    
    await saveViewerWithLock(viewer);
    
    // Add delay before taking screenshot to prevent concurrent saves
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Take an initial screenshot
    try {
      await takeTabScreenshot(viewerId, newTabIndex);
    } catch (screenshotError) {
      logger.warn(`Failed to take initial screenshot for new tab: ${screenshotError.message}`);
    }
    
    logger.info(`Added new tab ${newTabIndex} for viewer ${viewer.name}`);
    
    return newTabIndex;
  } catch (error) {
    logger.error(`Error adding new tab for viewer ${viewer.name}: ${error.message}`);
    throw error;
  }
}

/**
 * Close a specific tab
 * @param {string} viewerId - ID of the viewer
 * @param {number} tabIndex - Index of the tab to close
 * @returns {Promise<boolean>} - Success status
 */
async function closeViewerTab(viewerId, tabIndex) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer) {
    throw new Error('Viewer not found');
  }
  
  if (viewer.status !== 'running' && viewer.status !== 'partial') {
    throw new Error('Viewer is not running');
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    throw new Error('Browser instance not found');
  }
  
  const { pages } = browserInstances.get(viewerId.toString());
  
  if (!pages[tabIndex]) {
    throw new Error(`Tab ${tabIndex} not found or already closed`);
  }
  
  // If this is the only tab, prevent closing
  if (pages.filter(p => p !== undefined).length === 1) {
    throw new Error('Cannot close the only tab. Use stopViewer instead');
  }
  
  logger.info(`Closing tab ${tabIndex} for viewer ${viewer.name}`);
  
  try {
    // Close the page
    await pages[tabIndex].close();
    
    // Set the page to undefined (don't remove to maintain tab indices)
    pages[tabIndex] = undefined;
    
    // Update viewer tabInfo (internal)
    if (viewer.tabInfo && viewer.tabInfo[tabIndex]) {
      viewer.tabInfo[tabIndex].status = 'closed';
      viewer.tabInfo[tabIndex].lastUpdated = new Date();
    }
    
    // Update viewer tabs (frontend schema)
    if (viewer.tabs && viewer.tabs[tabIndex]) {
      viewer.tabs[tabIndex].status = 'closed';
    }
    
    // Remove from active tabs
    if (viewer.activeTabs) {
      viewer.activeTabs = viewer.activeTabs.filter(i => i !== tabIndex);
    }
    
    await saveViewerWithLock(viewer);
    
    logger.info(`Closed tab ${tabIndex} for viewer ${viewer.name}`);
    
    return true;
  } catch (error) {
    logger.error(`Error closing tab ${tabIndex} for viewer ${viewer.name}: ${error.message}`);
    throw error;
  }
}

/**
 * Get all active browser instances for resource management
 * @returns {Map} Map of browser instances keyed by viewer ID
 */
function getBrowserInstances() {
  return browserInstances;
}

/**
 * Get tab statistics for a viewer
 * @param {string} viewerId - ID of the viewer
 * @returns {Promise<Object>} - Tab statistics
 */
async function getViewerTabStats(viewerId) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer) {
    throw new Error('Viewer not found');
  }
  
  const stats = {
    viewerId: viewer._id,
    viewerName: viewer.name,
    status: viewer.status,
    totalTabs: viewer.tabCount || 0,
    activeTabs: viewer.activeTabs ? viewer.activeTabs.length : 0,
    tabInfo: viewer.tabInfo || [],
    browserRunning: browserInstances.has(viewerId.toString())
  };
  
  // Add memory usage if browser is running
  if (browserInstances.has(viewerId.toString())) {
    const { browser, pages } = browserInstances.get(viewerId.toString());
    
    try {
      // Get browser process info
      const processes = await browser.process().takeHeapSnapshot();
      stats.memoryUsage = processes ? processes.jsHeapSizeLimit : 'unknown';
      
      // Count active pages
      stats.actualActiveTabs = pages.filter(p => p !== undefined).length;
    } catch (error) {
      stats.memoryUsage = 'error getting memory usage';
      stats.memoryError = error.message;
    }
  }
  
  return stats;
}

module.exports = {
  startViewer,
  stopViewer,
  takeTabScreenshot,
  takeAllTabsScreenshots,
  forceRefreshTab,
  forceTabLowestQuality,
  forceViewerLowestQuality,
  forceAllViewersLowestQuality,
  saveViewerWithLock,
  startUpdateInterval,
  clearUpdateInterval,
  updateViewerTabs,
  updateTabData,
  addViewerTab,
  closeViewerTab,
  getBrowserInstances,
  getViewerTabStats
};