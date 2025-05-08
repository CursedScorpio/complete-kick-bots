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
const fs = require('fs');

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
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
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
  const maxRetries = 3;
  const initialDelay = 100;
  
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
              freshViewer[key] = viewer[key];
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
        if (error.message && error.message.includes("parallel")) {
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
 * Start a viewer specifically optimized for Kick.com
 * @param {string} viewerId - ID of the viewer
 * @returns {Promise<boolean>} - Success status
 */
async function startViewer(viewerId) {
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
  
  logger.info(`Starting Kick.com viewer ${viewer.name} for stream ${viewer.streamUrl}`);
  
  // Check if we've had failed attempts with this viewer before
  const attempts = failedAttempts.get(viewerId) || 0;
  
  // Generate a mobile fingerprint for better Kick.com compatibility
  const browserFingerprint = browserUtils.generateMobileFingerprint();
  
  // Update viewer with the fingerprint
  viewer.browserFingerprint = browserFingerprint;
  viewer.status = 'starting';
  await saveViewerWithLock(viewer);
  
  try {
    // Enhanced launch options specifically for Kick.com
    const launchOptions = {
      headless: config.puppeteer.headless,
      executablePath: '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        // Mobile features for better compatibility
        '--enable-features=NetworkService,NetworkServiceInProcess',
        '--disable-features=IsolateOrigins,site-per-process',
        // Allow WebGL and similar features that Kick.com needs
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
        '--enable-zero-copy',
        // Set mobile viewport
        `--window-size=${browserFingerprint.screenResolution.width},${browserFingerprint.screenResolution.height}`,
        // Mobile emulation essentials
        '--touch-events=enabled',
        '--enable-touch-drag-drop',
        '--enable-touchpad-smooth-scrolling',
        // Media playback features
        '--autoplay-policy=no-user-gesture-required',
        '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies',
        // Don't block media
        '--allow-running-insecure-content',
        '--autoplay-policy=user-gesture-required',
        // Other essential configs
        '--disable-extensions',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-first-run',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-ipc-flooding-protection',
        '--disable-site-isolation-trials',
        '--disable-blink-features=AutomationControlled',
        '--ignore-certificate-errors',
        // Enable improved media handling for mobile
        '--enable-features=HandwritingRecognition,OverlayScrollbar,OverscrollHistoryNavigation',
        `--user-agent=${browserFingerprint.userAgent}`
      ],
      ignoreHTTPSErrors: true,
      defaultViewport: {
        width: browserFingerprint.screenResolution.width,
        height: browserFingerprint.screenResolution.height,
        deviceScaleFactor: browserFingerprint.isIOS ? 3 : 2.75,
        hasTouch: true,
        isLandscape: browserFingerprint.isLandscape,
        isMobile: true
      },
      timeout: 60000 // 60 second timeout for browser launch
    };
    
    // Kick.com specific: Add mobile emulation if needed
    if (attempts > 0) {
      // After a failure, try different device emulation
      const mobileDevices = [
        'Pixel 5',
        'Pixel 4',
        'iPhone X',
        'iPhone 11',
        'Samsung Galaxy S20'
      ];
      
      const deviceToEmulate = mobileDevices[attempts % mobileDevices.length];
      logger.info(`Retry attempt ${attempts}: Using device emulation for ${deviceToEmulate}`);
      
      // Add device emulation
      launchOptions.args.push(`--user-agent=${browserFingerprint.userAgent}`);
    }
    
    // Launch a new browser instance
    const browser = await puppeteer.launch(launchOptions);
    
    // Create a new page
    const page = await browser.newPage();
    
    // Apply mobile fingerprinting for Kick.com
    await browserUtils.applyMobileFingerprinting(page, browserFingerprint);
    
    // Set up request interception specially tuned for Kick.com
    await kickStreamHandler.setupKickRequestInterception(page);
    
    // Add error handling for unexpected browser disconnection
    browser.on('disconnected', async () => {
      logger.error(`Browser disconnected unexpectedly for viewer ${viewer.name}`);
      
      // Check if the viewer is still in the active database
      const currentViewer = await Viewer.findById(viewerId);
      if (!currentViewer || currentViewer.status === 'idle' || currentViewer.status === 'error') {
        logger.info(`Viewer ${viewerId} is no longer active, not reconnecting after disconnect`);
        return;
      }
      
      try {
        // Remove from browser instances
        if (browserInstances.has(viewerId.toString())) {
          browserInstances.delete(viewerId.toString());
        }
        
        // Update viewer status
        currentViewer.status = 'error';
        currentViewer.error = 'Browser disconnected unexpectedly';
        await saveViewerWithLock(currentViewer);
        
        // Attempt to restart the viewer
        setTimeout(async () => {
          try {
            logger.info(`Attempting to restart viewer ${viewer.name} after disconnect`);
            await startViewer(viewerId);
          } catch (restartError) {
            logger.error(`Failed to restart viewer ${viewer.name} after disconnect: ${restartError.message}`);
          }
        }, 5000); // Wait 5 seconds before trying to restart
      } catch (error) {
        logger.error(`Error handling browser disconnect for viewer ${viewer.name}: ${error.message}`);
      }
    });
    
    // Add page event listeners for logging
    page.on('console', async (msg) => {
      const logLevel = msg.type() === 'error' ? 'error' : 
                      msg.type() === 'warning' ? 'warn' : 'debug';
      
      // Log all console messages during debugging
      logger[logLevel](`Console ${msg.type()} (${viewer.name}): ${msg.text()}`);
      
      // Add critical errors to viewer logs
      if (logLevel === 'error' || (logLevel === 'warn' && msg.text().includes('WebGPU'))) {
        viewer.logs.push({
          level: logLevel,
          message: `Console ${msg.type()}: ${msg.text()}`,
        });
        
        // If too many logs, remove oldest
        if (viewer.logs.length > 100) {
          viewer.logs = viewer.logs.slice(-100);
        }
        
        await saveViewerWithLock(viewer);
      }
    });
    
    // Store the browser and page instances
    browserInstances.set(viewerId.toString(), { browser, page });
    
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
    
    // Navigate to the stream URL with enhanced timeouts and options for Kick.com
    try {
      await page.goto(viewer.streamUrl, { 
        waitUntil: 'domcontentloaded', // Initial load with domcontentloaded
        timeout: 30000 // 30 seconds timeout
      });
      
      // Wait for necessary resources to load
      await page.waitForTimeout(5000);
    } catch (navigationError) {
      logger.warn(`Initial navigation had issues: ${navigationError.message}. Continuing anyway...`);
      // We continue despite navigation errors as Kick.com sometimes has script errors
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
        logger.info(`Video player found with selector "${selector}" for viewer ${viewer.name}`);
        videoPlayerFound = true;
        break;
      } catch (selectorError) {
        logger.debug(`Selector "${selector}" not found for viewer ${viewer.name}, trying next...`);
      }
    }
    
    if (!videoPlayerFound) {
      // Try to handle 403 error page by reloading
      const has403Error = await page.evaluate(() => {
        return document.body.innerText.includes('403') || 
               document.body.innerText.includes('Forbidden') ||
               document.body.innerText.includes('Access Denied');
      });
      
      if (has403Error) {
        logger.warn(`403 Forbidden detected for ${viewer.name}, trying to recover`);
        
        // Increment failed attempts counter
        failedAttempts.set(viewerId, (failedAttempts.get(viewerId) || 0) + 1);
        
        // Take a screenshot for debugging
        const filename = `${viewerId}-403forbidden-${Date.now()}.png`;
        const screenshotPath = path.join(screenshotsDir, filename);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        
        // Update viewer with error
        viewer.status = 'error';
        viewer.error = '403 Forbidden detected - Kick.com bot protection';
        viewer.lastScreenshot = filename;
        await saveViewerWithLock(viewer);
        
        // Clean up
        await browser.close().catch(() => {});
        browserInstances.delete(viewerId.toString());
        
        // If we've had too many failed attempts, give up
        if (failedAttempts.get(viewerId) > 3) {
          throw new Error('Multiple 403 Forbidden responses - Kick.com is blocking this viewer');
        }
        
        // Try again with a different fingerprint
        logger.info(`Retrying with a different mobile fingerprint`);
        return startViewer(viewerId);
      }
      
      logger.error(`No video player found for viewer ${viewer.name}`);
      
      // Take a screenshot to debug what's happening
      const filename = `${viewerId}-failed-${Date.now()}.png`;
      const screenshotPath = path.join(screenshotsDir, filename);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.info(`Debug screenshot saved at ${screenshotPath}`);
      
      // Get page HTML for debugging
      const pageHtml = await page.content();
      logger.debug(`Page HTML for failed video player detection: ${pageHtml.substring(0, 500)}...`);
      
      throw new Error('Video player not found after trying multiple selectors');
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
    
    // Check if the stream is live
    const isLive = await kickStreamHandler.checkKickStreamStatus(page);
    if (!isLive) {
      logger.warn(`Stream ${viewer.streamUrl} appears to be offline for viewer ${viewer.name}`);
    } else {
      logger.info(`Stream ${viewer.streamUrl} is live for viewer ${viewer.name}`);
    }
    
    // Extract stream information
    const streamMetadata = await kickStreamHandler.extractKickMetadata(page);
    viewer.streamMetadata = streamMetadata;
    
    // Start the update interval for this viewer
    startUpdateInterval(viewerId);
    
    // Update viewer status
    viewer.status = 'running';
    viewer.error = null;
    viewer.lastActivityAt = new Date();
    await saveViewerWithLock(viewer);
    
    // Reset failed attempts counter on success
    if (failedAttempts.has(viewerId)) {
      failedAttempts.delete(viewerId);
    }
    
    // Check if stream exists in database, if not create it
    let stream = await Stream.findOne({ url: viewer.streamUrl });
    if (!stream) {
      stream = new Stream({
        url: viewer.streamUrl,
        streamer: streamMetadata.streamerName || viewer.streamUrl.split('/').pop(),
        title: streamMetadata.title || '',
        game: streamMetadata.game || '',
        viewers: streamMetadata.viewers || 0,
        isLive: isLive,
        activeViewers: [viewer._id],
      });
      await stream.save();
    } else {
      // Update stream info
      stream.title = streamMetadata.title || stream.title;
      stream.game = streamMetadata.game || stream.game;
      stream.viewers = streamMetadata.viewers || stream.viewers;
      stream.isLive = isLive;
      
      // Add this viewer to active viewers if not already added
      if (!stream.activeViewers.includes(viewer._id)) {
        stream.activeViewers.push(viewer._id);
      }
      await stream.save();
    }
    
    logger.info(`Viewer ${viewer.name} started successfully`);
    
    // Take an initial screenshot
    try {
      await takeScreenshot(viewerId);
    } catch (screenshotError) {
      logger.warn(`Failed to take initial screenshot: ${screenshotError.message}`);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error starting viewer ${viewer.name}: ${error.message}`);
    
    // Update viewer status
    viewer.status = 'error';
    viewer.error = error.message;
    await saveViewerWithLock(viewer);
    
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
  
  logger.info(`Stopping viewer ${viewer.name}`);
  
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
 * Take a screenshot of what the viewer is seeing
 * @param {string} viewerId - ID of the viewer
 * @returns {Promise<string>} - Path to the screenshot
 */
async function takeScreenshot(viewerId) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer) {
    throw new Error('Viewer not found');
  }
  
  if (viewer.status !== 'running') {
    throw new Error('Viewer is not running');
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    throw new Error('Browser instance not found');
  }
  
  logger.info(`Taking screenshot for viewer ${viewer.name}`);
  
  try {
    const { page } = browserInstances.get(viewerId.toString());
    
    // Generate a unique filename
    const filename = `${viewerId}-${uuidv4()}.png`;
    const screenshotPath = path.join(screenshotsDir, filename);
    
    // Take screenshot - use mobile viewport size
    await page.screenshot({ 
      path: screenshotPath, 
      fullPage: false,
      type: 'png',
      captureBeyondViewport: true
    });
    
    logger.info(`Screenshot taken for viewer ${viewer.name}: ${filename}`);
    
    // Update viewer with screenshot info
    viewer.lastScreenshot = filename;
    viewer.lastActivityAt = new Date();
    await saveViewerWithLock(viewer);
    
    return screenshotPath;
  } catch (error) {
    logger.error(`Error taking screenshot for viewer ${viewer.name}: ${error.message}`);
    throw error;
  }
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
      await updateViewerData(viewerId);
    } catch (error) {
      logger.error(`Error updating viewer ${viewerId}: ${error.message}`);
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
 * Update viewer data specifically for Kick.com
 * @param {string} viewerId - ID of the viewer
 */
async function updateViewerData(viewerId) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer || viewer.status !== 'running') {
    return;
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    return;
  }
  
  const { page } = browserInstances.get(viewerId.toString());
  
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
    
    // Check if stream is still live
    const isLive = await kickStreamHandler.checkKickStreamStatus(page);
    
    // Extract stream metadata
    const streamMetadata = await kickStreamHandler.extractKickMetadata(page);
    
    // Extract playback status
    const playbackStatus = await kickStreamHandler.extractKickPlaybackStatus(page);
    
    // Extract chat messages if this viewer has chat parsing enabled
    if (viewer.isParseChatEnabled) {
      try {
        const chatMessages = await kickStreamHandler.extractKickChatMessages(page);
        
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
    
    // Take a screenshot periodically (every 15th update)
    const viewerUpdateCount = viewer.updateCount || 0;
    if (viewerUpdateCount % 15 === 0) {
      try {
        await takeScreenshot(viewerId);
      } catch (screenshotError) {
        logger.debug(`Failed to take periodic screenshot: ${screenshotError.message}`);
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
    
    // Update viewer data
    viewer.streamMetadata = {
      ...viewer.streamMetadata,
      ...streamMetadata,
      isLive
    };
    viewer.playbackStatus = playbackStatus;
    viewer.lastActivityAt = new Date();
    viewer.updateCount = (viewerUpdateCount + 1);
    await saveViewerWithLock(viewer);
    
    // For Kick.com, handle stream issues more aggressively
    if (!isLive || !playbackStatus.isPlaying || playbackStatus.isBuffering || playbackStatus.error) {
      logger.warn(`Stream issues detected for viewer ${viewer.name}: isLive=${isLive}, isPlaying=${playbackStatus.isPlaying}, isBuffering=${playbackStatus.isBuffering}, error=${playbackStatus.error}`);
      
      // Add to viewer logs
      viewer.logs.push({
        level: 'warn',
        message: `Stream issues: ${!isLive ? 'Offline' : playbackStatus.error || 'Playback problem'}`,
      });
      
      // If too many logs, remove oldest
      if (viewer.logs.length > 100) {
        viewer.logs = viewer.logs.slice(-100);
      }
      
      await saveViewerWithLock(viewer);
      
      // Try to recover with specialized mobile-focused fixes
      await kickStreamHandler.fixKickStreamIssues(viewerId, browserInstances, failedAttempts, startViewer, stopViewer, takeScreenshot, saveViewerWithLock, screenshotsDir);
    }
  } catch (error) {
    logger.error(`Error updating data for viewer ${viewer.name}: ${error.message}`);
    
    // Add to viewer logs
    viewer.logs.push({
      level: 'error',
      message: `Update error: ${error.message}`,
    });
    
    // If too many logs, remove oldest
    if (viewer.logs.length > 100) {
      viewer.logs = viewer.logs.slice(-100);
    }
    
    await saveViewerWithLock(viewer);
  }
}

/**
 * Force refresh a Kick.com stream to recover from issues
 * @param {string} viewerId - ID of the viewer
 */
async function forceRefreshKickStream(viewerId) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer) {
    throw new Error('Viewer not found');
  }
  
  if (viewer.status !== 'running') {
    throw new Error('Viewer is not running');
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    throw new Error('Browser instance not found');
  }
  
  logger.info(`Forcing refresh for Kick.com stream for viewer ${viewer.name}`);
  
  try {
    const { page } = browserInstances.get(viewerId.toString());
    
    // Update viewer status
    viewer.status = 'refreshing';
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
    
    // Update viewer status
    viewer.status = 'running';
    viewer.playbackStatus = playbackStatus;
    viewer.lastActivityAt = new Date();
    await saveViewerWithLock(viewer);
    
    logger.info(`Force refresh completed for viewer ${viewer.name}`);
    
    // Take a screenshot to confirm state
    try {
      await takeScreenshot(viewerId);
    } catch (screenshotError) {
      logger.debug(`Failed to take post-refresh screenshot: ${screenshotError.message}`);
    }
    
    return playbackStatus.isPlaying;
  } catch (error) {
    logger.error(`Error during force refresh for viewer ${viewer.name}: ${error.message}`);
    
    // Update viewer status back to running
    viewer.status = 'running';
    viewer.error = `Force refresh failed: ${error.message}`;
    await saveViewerWithLock(viewer);
    
    throw error;
  }
}

/**
 * Force Kick.com stream to use lowest quality (160p)
 * @param {string} viewerId - ID of the viewer
 * @returns {Promise<boolean>} - Success status
 */
async function forceLowestQuality(viewerId) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer) {
    throw new Error('Viewer not found');
  }
  
  if (viewer.status !== 'running') {
    throw new Error('Viewer is not running');
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    throw new Error('Browser instance not found');
  }
  
  logger.info(`Setting lowest quality (160p) for viewer ${viewer.name}`);
  
  try {
    const { page } = browserInstances.get(viewerId.toString());
    
    // Execute quality change in the browser context
    const qualityChanged = await page.evaluate(() => {
      try {
        // Function to create touch events (important for mobile)
        function createAndDispatchTouchEvent(element, eventType) {
          if (!element) return false;
          
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
          return true;
        }
        
        // Step 1: Find and click on the settings/gear icon
        console.log("Looking for settings button...");
        
        // First, make sure the player controls are visible by interacting with the player
        const player = document.querySelector('#video-player') || document.querySelector('video');
        if (player) {
          createAndDispatchTouchEvent(player, 'touchstart');
          setTimeout(() => createAndDispatchTouchEvent(player, 'touchend'), 100);
          console.log("Touched player to show controls");
        }
        
        // Wait a moment for controls to appear
        setTimeout(() => {
          // Look for settings/gear button
          const settingsSelectors = [
            // Common selectors for settings icons
            '[aria-label="Settings"]',
            'button[class*="settings"]',
            'button[class*="gear"]',
            'button[class*="cog"]',
            '.settings-button',
            '.vjs-settings-button',
            '.player-settings-button',
            // More generic selectors
            'button svg[class*="settings"]',
            'button svg[class*="gear"]',
            'button svg[class*="cog"]'
          ];
          
          let settingsButton = null;
          for (const selector of settingsSelectors) {
            const buttons = document.querySelectorAll(selector);
            for (const button of buttons) {
              if (button.offsetParent !== null) { // Check if visible
                settingsButton = button;
                break;
              }
            }
            if (settingsButton) break;
          }
          
          if (!settingsButton) {
            console.log("Settings button not found");
            return false;
          }
          
          console.log("Settings button found, clicking it");
          createAndDispatchTouchEvent(settingsButton, 'touchstart');
          setTimeout(() => createAndDispatchTouchEvent(settingsButton, 'touchend'), 100);
          
          // Step 2: After the settings menu opens, find the quality option
          setTimeout(() => {
            // Look for the 160p option using the exact HTML structure provided
            console.log("Looking for 160p option...");
            
            // Use the exact selector for the 160p option
            const qualityOptionSelector = 'div[role="menuitemradio"][data-state="unchecked"][data-orientation="vertical"]:contains("160p")';
            
            // If querySelector doesn't support :contains, try these alternatives
            const qualityOptions = [
              // Exact selector based on the HTML provided
              'div[role="menuitemradio"][data-orientation="vertical"]',
              // Broader selectors that might match
              '[role="menuitemradio"]',
              '[data-state="unchecked"]',
              '[data-orientation="vertical"]',
              // Classes used in the provided HTML
              '.relative.flex.h-\\[30px\\].cursor-pointer.select-none.items-center',
              // Any menu item that contains 160p
              '*:not([style*="display: none"]):contains("160p")'
            ];
            
            let qualityOption = null;
            
            for (const selector of qualityOptions) {
              const options = document.querySelectorAll(selector);
              
              for (const option of options) {
                if (option.offsetParent === null) continue; // Skip if not visible
                
                const text = option.innerText || option.textContent || "";
                if (text.trim() === "160p") {
                  qualityOption = option;
                  break;
                }
              }
              
              if (qualityOption) break;
            }
            
            if (!qualityOption) {
              console.log("160p quality option not found");
              return false;
            }
            
            console.log("160p quality option found, clicking it");
            createAndDispatchTouchEvent(qualityOption, 'touchstart');
            setTimeout(() => createAndDispatchTouchEvent(qualityOption, 'touchend'), 100);
            
            return true;
          }, 500); // Wait for quality menu to appear
        }, 500); // Wait for player controls to show
        
        return true;
      } catch (error) {
        console.error("Error setting quality to 160p:", error);
        return false;
      }
    });
    
    // Update viewer with quality change attempt
    viewer.lastActivityAt = new Date();
    viewer.logs.push({
      level: 'info',
      message: `Attempted to set quality to 160p: ${qualityChanged ? 'Success' : 'Failed'}`
    });
    
    // If too many logs, remove oldest
    if (viewer.logs.length > 100) {
      viewer.logs = viewer.logs.slice(-100);
    }
    
    await saveViewerWithLock(viewer);
    
    // Take a screenshot to confirm
    try {
      await takeScreenshot(viewerId);
    } catch (error) {
      logger.debug(`Failed to take post-quality-change screenshot: ${error.message}`);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error setting lowest quality for viewer ${viewer.name}: ${error.message}`);
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
      await forceLowestQuality(viewer._id);
      results.successful++;
      
      // Add a small delay between operations to avoid overloading
      await new Promise(resolve => setTimeout(resolve, 500));
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
 * Get all active browser instances for resource management
 * @returns {Map} Map of browser instances keyed by viewer ID
 */
function getBrowserInstances() {
  return browserInstances;
}

module.exports = {
  startViewer,
  stopViewer,
  takeScreenshot,
  forceRefreshKickStream,
  forceLowestQuality,
  forceAllViewersLowestQuality,
  saveViewerWithLock,
  startUpdateInterval,
  clearUpdateInterval,
  updateViewerData,
  getBrowserInstances
};