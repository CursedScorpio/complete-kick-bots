// services/kickStreamHandler.js
const path = require('path');
const Viewer = require('../models/Viewer');
const logger = require('../utils/logger');

/**
 * Configure browser to intercept and handle requests for Kick.com
 * @param {Object} page - Puppeteer page object
 */
async function setupKickRequestInterception(page) {
  await page.setRequestInterception(true);
  
  page.on('request', (request) => {
    const url = request.url().toLowerCase();
    const resourceType = request.resourceType();
    
    // Fix for websocket token issue - detected in logs
    if (url.includes('websockets.kick.com/viewer/v1/token')) {
      // Modify the request to handle CORS issues
      const newHeaders = {
        ...request.headers(),
        'Origin': 'https://kick.com',
        'Referer': 'https://kick.com/',
      };
      
      // Remove problematic headers
      delete newHeaders['upgrade-insecure-requests'];
      
      // Continue with modified headers
      request.continue({ headers: newHeaders });
      return;
    }
    
    // Datadoghq CORS issue fix - detected in logs
    if (url.includes('datadoghq.com')) {
      // Remove problematic headers
      const newHeaders = {
        ...request.headers()
      };
      
      delete newHeaders['upgrade-insecure-requests'];
      
      request.continue({ headers: newHeaders });
      return;
    }
    
    // Block requests to cdndex.io that cause CORS errors
    if (url.includes('cdndex.io')) {
      request.abort();
      return;
    }
    
    // Critical Kick.com resources that should always be allowed
    if (url.includes('kick.com') && (
        url.includes('stream') || 
        url.includes('player') || 
        url.includes('chat') || 
        url.includes('live') ||
        url.includes('api') ||
        url.includes('ws') ||
        url.includes('edge') ||
        url.includes('cdn') ||
        url.includes('media') ||
        url.includes('video') ||
        url.includes('cast') ||
        url.includes('/x/') || // Common in Kick resource URLs
        url.includes('assets') ||
        url.includes('hls') ||
        url.includes('m3u8') ||
        url.includes('.ts') ||
        url.includes('.js') ||  // Allow all JavaScript files - needed for player
        url.includes('.css')    // Allow all CSS files - needed for player
      )) {
      request.continue();
      return;
    }
    
    // Allow through connections to Kick websockets and essential CDNs
    if (url.includes('websocket') || 
        url.includes('wss://') || 
        url.includes('ws://') || 
        url.includes('media.kick.com') ||
        url.includes('video.kick.com') ||
        url.includes('datadoghq.com') ||
        url.includes('akamaihd.net') ||
        url.includes('cloudfront.net') ||
        url.includes('fastly.net')) {
      request.continue();
      return;
    }
    
    // Critical resource types for streaming should be allowed
    if (resourceType === 'websocket' || 
        resourceType === 'media' || 
        resourceType === 'xhr' || 
        resourceType === 'fetch' ||
        resourceType === 'script' ||
        resourceType === 'stylesheet') {
      request.continue();
      return;
    }
    
    // Block analytics, trackers, fingerprinting scripts, and unnecessary resources
    if (
      // Block common tracking and fingerprinting services
      url.includes('google-analytics') ||
      url.includes('googletagmanager') ||
      url.includes('doubleclick') ||
      url.includes('facebook.net') ||
      url.includes('hotjar') ||
      url.includes('amplitude') ||
      url.includes('segment.io') ||
      url.includes('mixpanel') ||
      url.includes('fingerprint') ||
      url.includes('clarity.ms') ||
      url.includes('recaptcha') ||
      url.includes('perimeterx') ||
      url.includes('cloudflare-insights') ||
      url.includes('omtrdc.net') ||
      url.includes('evidon') ||
      url.includes('stickyadstv') ||
      url.includes('moatads') ||
      url.includes('adroll') ||
      url.includes('hcaptcha.com') ||
      url.includes('quantserve') ||
      url.includes('pendo.io') ||
      
      // Block unnecessary resource types (except for video player resources)
      (resourceType === 'image' && 
       !url.includes('player') && 
       !url.includes('stream') && 
       !url.includes('logo') && 
       !url.includes('avatar') &&
       !url.includes('kick.com')) ||
      (resourceType === 'font' && !url.includes('kick.com'))
    ) {
      request.abort();
    } else {
      request.continue();
    }
  });
  
  // Listen for response errors to detect blocked resources
  page.on('response', async (response) => {
    const url = response.url().toLowerCase();
    const status = response.status();
    
    // Focus on detecting 403 Forbidden responses (bot detection)
    if (status === 403 && url.includes('kick.com')) {
      // Log details for key resources
      if (url.includes('stream') || url.includes('player') || url.includes('.js')) {
        logger.warn(`403 Forbidden response for critical resource: ${url}`);
      }
    }
  });
}

/**
 * Handle common page barriers on Kick.com
 * @param {Object} page - Puppeteer page object
 */
async function handleKickPageBarriers(page) {
  try {
    // Wait for page to load enough to find common barriers
    await page.waitForTimeout(2000);
    
    // Block problematic scripts that cause CORS errors
    await page.evaluateOnNewDocument(() => {
      // Block scripts from problematic domains
      const originalCreateElement = document.createElement;
      document.createElement = function(tagName) {
        const element = originalCreateElement.call(document, tagName);
        
        if (tagName.toLowerCase() === 'script') {
          const originalSetAttribute = element.setAttribute;
          element.setAttribute = function(name, value) {
            if (name === 'src') {
              const blockedDomains = [
                'cdndex.io',
                'reporting.cdndex',
                'tracker.cdndex'
              ];
              
              // Check if the source matches any blocked domain
              if (blockedDomains.some(domain => value.includes(domain))) {
                console.warn(`Blocking script from: ${value}`);
                return;
              }
            }
            return originalSetAttribute.call(this, name, value);
          };
        }
        
        return element;
      };
    });
    
    // Look for and handle cookie consent dialogs
    const cookieSelectors = [
      '[id*="cookie"][id*="banner"] button, [id*="cookie"][id*="popup"] button',
      '[id*="cookie"][id*="banner"] a, [id*="cookie"][id*="popup"] a',
      '[class*="cookie"][class*="banner"] button, [class*="cookie"][class*="popup"] button',
      '[class*="cookie"][class*="consent"] button',
      '[id*="consent"] button[id*="accept"], [id*="consent"] button[id*="agree"]',
      '[id*="privacy"][id*="banner"] button, [id*="gdpr"] button',
      'button[id*="accept"], button[id*="agree"]',
      'button[class*="accept"], button[class*="agree"]',
      // Specific platforms
      '.fc-button.fc-cta-consent',
      '.qc-cmp2-summary-buttons button',
      '.css-47sehv',
      '#onetrust-accept-btn-handler',
      '.iubenda-cs-accept-btn',
      '#didomi-notice-agree-button',
      '.js-accept-cookies'
    ];
    
    for (const selector of cookieSelectors) {
      try {
        const consentButtons = await page.$$(selector);
        if (consentButtons.length > 0) {
          logger.info(`Found consent prompt with selector: ${selector}`);
          for (const button of consentButtons) {
            const buttonText = await page.evaluate(el => el.innerText, button);
            if (buttonText && (
                buttonText.toLowerCase().includes('accept') || 
                buttonText.toLowerCase().includes('agree') || 
                buttonText.toLowerCase().includes('consent') ||
                buttonText.toLowerCase().includes('allow') ||
                buttonText.toLowerCase().includes('ok'))) {
              logger.info(`Clicking consent button with text: ${buttonText}`);
              await button.click();
              await page.waitForTimeout(1000);
              break;
            }
          }
        }
      } catch (error) {
        // Ignore errors for specific selectors
        logger.debug(`Failed with selector ${selector}: ${error.message}`);
      }
    }
    
    // Handle modal dialogs and overlays
    const modalSelectors = [
      'div[role="dialog"] button[aria-label="Close"]',
      'div[class*="modal"] button[class*="close"]',
      'div[id*="modal"] button[id*="close"]',
      'div[class*="popup"] button[class*="close"]',
      '.overlay button.close, .modal button.close',
      '[class*="overlay"] [class*="close"], [id*="overlay"] [id*="close"]'
    ];
    
    for (const selector of modalSelectors) {
      try {
        const closeButtons = await page.$$(selector);
        if (closeButtons.length > 0) {
          logger.info(`Found modal/overlay with selector: ${selector}`);
          await closeButtons[0].click();
          await page.waitForTimeout(1000);
        }
      } catch (error) {
        // Ignore errors for specific selectors
        logger.debug(`Failed with modal selector ${selector}: ${error.message}`);
      }
    }
    
    // Try to ensure video autoplay using both click and programmatic play
    try {
      // Kick-specific mobile video handling - using touch events
      await page.evaluate(() => {
        try {
          // Find Kick video player
          const kickPlayer = document.querySelector('#video-player');
          if (kickPlayer) {
            console.log("Found Kick video player, applying mobile optimizations");
            
            // Apply mobile optimizations
            kickPlayer.muted = false;
            kickPlayer.volume = 0.5;
            kickPlayer.controls = true;
            kickPlayer.playsInline = true;
            kickPlayer.autoplay = true;
            
            // Use touch events (important for mobile)
            if (window.createTouchEvent) {
              window.createTouchEvent(kickPlayer, 'touchstart');
              window.createTouchEvent(kickPlayer, 'touchend');
            }
            
            // Force play
            kickPlayer.play().catch(e => console.warn("Initial play failed:", e));
            
            // Continue to check and ensure playback
            setTimeout(() => {
              if (kickPlayer.paused) {
                console.log("Player still paused, trying again");
                kickPlayer.play().catch(e => console.warn("Retry play failed:", e));
              }
            }, 2000);
            
            return true;
          } else {
            console.log("Kick video player not found, trying generic video element");
            const video = document.querySelector('video');
            if (video) {
              // Apply same optimizations to generic video
              video.muted = false;
              video.volume = 0.5;
              video.controls = true;
              video.playsInline = true;
              video.autoplay = true;
              
              if (window.createTouchEvent) {
                window.createTouchEvent(video, 'touchstart');
                window.createTouchEvent(video, 'touchend');
              }
              
              video.play().catch(e => console.warn("Generic play failed:", e));
              return true;
            }
          }
          
          return false;
        } catch (e) {
          console.error("Error in video autoplay handling:", e);
          return false;
        }
      });
      
      // Also try clicking play buttons
      const playButtonSelectors = [
        '.play-button',
        '.vjs-big-play-button',
        '.player-control-playpause',
        '.player__play-button',
        '[aria-label="Play"]',
        'button.play',
        // Additional selectors specific to Kick
        '.control-icon-container', 
        '.vjs-play-control',
        '.video-react-play-control'
      ];
      
      for (const selector of playButtonSelectors) {
        try {
          const playButtons = await page.$$(selector);
          if (playButtons.length > 0) {
            logger.info(`Found play button with selector: ${selector}`);
            
            // Use touchscreen gesture for mobile emulation
            const buttonPosition = await page.evaluate(el => {
              const rect = el.getBoundingClientRect();
              return {
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2
              };
            }, playButtons[0]);
            
            // Execute touch events
            await page.touchscreen.tap(buttonPosition.x, buttonPosition.y);
            await page.waitForTimeout(500);
            
            // Check if video started playing
            const isPlaying = await page.evaluate(() => {
              const video = document.querySelector('#video-player') || document.querySelector('video');
              return video && !video.paused;
            });
            
            if (isPlaying) {
              logger.info(`Successfully started playback with ${selector}`);
              break;
            }
          }
        } catch (error) {
          logger.debug(`Failed with play button selector ${selector}: ${error.message}`);
        }
      }
    } catch (error) {
      logger.debug(`Failed to ensure video autoplay: ${error.message}`);
    }
  } catch (error) {
    logger.warn(`Error handling Kick page barriers: ${error.message}`);
    // Don't throw so the process can continue
  }
}

/**
 * Check if a stream is live on Kick.com
 * @param {Object} page - Puppeteer page object
 * @returns {boolean} - Whether the stream is live
 */
async function checkKickStreamStatus(page) {
  try {
    // Kick.com specific checks
    return await page.evaluate(() => {
      try {
        // Check for the Kick video player and its state
        const kickPlayer = document.querySelector('#video-player');
        let isVideoPlaying = false;
        
        if (kickPlayer) {
          isVideoPlaying = !kickPlayer.paused && 
                           !kickPlayer.ended && 
                           kickPlayer.readyState > 2 &&
                           kickPlayer.currentTime > 0;
          
          // If we have a playing video, it's likely live
          if (isVideoPlaying) return true;
        }
        
        // Fallback to generic video elements
        const videos = document.querySelectorAll('video');
        for (const video of videos) {
          if (!video.paused && video.readyState > 2 && video.currentTime > 0) {
            isVideoPlaying = true;
            break;
          }
        }
        
        // Look for explicit "Live" indicators
        const liveIndicators = document.querySelectorAll(
          '.live-indicator, .stream-status--live, .status-live, ' +
          '[class*="live-indicator"], [class*="live-badge"], ' +
          '[data-status="live"], [class*="livestatus-live"]'
        );
        
        const hasLiveIndicator = liveIndicators.length > 0;
        
        // Look for explicit offline indicators
        const offlineIndicators = document.querySelectorAll(
          '.offline-indicator, .stream-status--offline, .status-offline, ' +
          '[class*="offline-indicator"], [data-status="offline"]'
        );
        
        const hasOfflineIndicator = offlineIndicators.length > 0;
        
        // Also check for text content indicating status
        const pageText = document.body.innerText.toLowerCase();
        const hasOfflineText = [
          'offline', 'not live', 'stream ended', 'no longer live',
          'was live', 'currently offline', 'this channel is not live'
        ].some(text => pageText.includes(text));
        
        // Decision logic
        if (isVideoPlaying) {
          // Video is playing, most reliable indicator
          return true;
        } else if (hasLiveIndicator && !hasOfflineIndicator) {
          // Live indicator present and no offline indicator
          return true;
        } else if (hasOfflineIndicator) {
          // Explicit offline indicator
          return false;
        } else if (hasOfflineText) {
          // Text suggests offline
          return false;
        }
        
        // Default - if video is loaded at all, consider it potentially live
        const videoElements = document.querySelectorAll('#video-player, video');
        return videoElements.length > 0;
      } catch (e) {
        console.error("Error checking stream status:", e);
        // If there's an error, fallback to checking for video element
        return !!document.querySelector('#video-player') || !!document.querySelector('video');
      }
    });
  } catch (error) {
    logger.error(`Failed to check Kick stream status: ${error.message}`);
    return false; // Assume not live on error
  }
}

/**
 * Extract stream information for Kick.com
 * @param {Object} page - Puppeteer page object
 * @returns {Object} - Stream metadata
 */
async function extractKickMetadata(page) {
  try {
    return await page.evaluate(() => {
      const metadata = {};
      
      try {
        // Kick.com specific stream title selectors
        const titleSelectors = [
          '.stream-title',
          '.channel-info-bar__title',
          '.info-container h3',
          'h1.video-info__title',
          '.channel-header h3',
          '.livestream-title'
        ];
        
        for (const selector of titleSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            metadata.title = element.innerText || element.textContent || '';
            if (metadata.title) {
              metadata.title = metadata.title.trim();
              break;
            }
          }
        }
        
        // Kick.com specific streamer name selectors
        const streamerSelectors = [
          '.channel-info-bar__username',
          '.streamer-name',
          '.channel-header__username',
          '.channel-header a h1',
          '.creator-name',
          '.channel-info-bar a[href*="/"]'
        ];
        
        for (const selector of streamerSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            metadata.streamerName = element.innerText || element.textContent || '';
            if (metadata.streamerName) {
              metadata.streamerName = metadata.streamerName.trim();
              break;
            }
          }
        }
        
        // Kick.com specific category/game selectors
        const gameSelectors = [
          '.category-name',
          '.category-tag',
          '.stream-category',
          '.channel-info-bar__category',
          'a[href*="/categories/"]'
        ];
        
        for (const selector of gameSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            metadata.game = element.innerText || element.textContent || '';
            if (metadata.game) {
              metadata.game = metadata.game.trim();
              break;
            }
          }
        }
        
        // Kick.com specific viewer count selectors
        const viewerSelectors = [
          '.viewer-count',
          '.viewers-count',
          '.channel-info-bar__viewers',
          '.stream-info-card__text',
          '.live-indicator-container span',
          '.indicators span'
        ];
        
        for (const selector of viewerSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            const text = element.innerText || element.textContent || '';
            const match = text.match(/(\d[\d,\.]+)\s*(viewer|watching|view)/i);
            if (match) {
              metadata.viewers = parseInt(match[1].replace(/[,\.]/g, ''));
              break;
            }
            
            // If it's just a number, assume it's viewers
            const numberMatch = text.match(/^[\s]*(\d[\d,\.]+)[\s]*$/);
            if (numberMatch) {
              metadata.viewers = parseInt(numberMatch[1].replace(/[,\.]/g, ''));
              break;
            }
          }
        }
        
        // Check if the stream is actually live
        const liveIndicators = document.querySelectorAll(
          '.live, .isLive, .live-indicator, .stream-status--live, [data-a-target="live-indicator"]'
        );
        metadata.isLive = liveIndicators.length > 0;
        
        // Video element status (most reliable)
        const video = document.querySelector('#video-player') || document.querySelector('video');
        if (video) {
          metadata.videoPresent = true;
          metadata.videoPlaying = !video.paused && video.readyState > 2;
          metadata.videoDuration = video.duration || 0;
          metadata.videoCurrentTime = video.currentTime || 0;
        } else {
          metadata.videoPresent = false;
        }
        
        return metadata;
      } catch (error) {
        console.error('Error extracting metadata:', error);
        return { error: error.message };
      }
    });
  } catch (error) {
    logger.error(`Failed to extract stream metadata: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * Extract stream playback status specific to Kick.com
 * @param {Object} page - Puppeteer page object
 * @returns {Object} - Playback status information
 */
async function extractKickPlaybackStatus(page) {
  try {
    return await page.evaluate(() => {
      const status = {
        isPlaying: false,
        isPaused: false,
        isBuffering: false,
        isMuted: false,
        volume: 0,
        quality: '',
        error: null
      };
      
      try {
        // Find Kick.com video player by ID
        const kickVideo = document.querySelector('#video-player');
        if (kickVideo) {
          status.isPlaying = !kickVideo.paused && !kickVideo.ended && kickVideo.currentTime > 0 && kickVideo.readyState > 2;
          status.isPaused = kickVideo.paused;
          status.isBuffering = kickVideo.readyState < 3;
          status.isMuted = kickVideo.muted;
          status.volume = Math.round(kickVideo.volume * 100);
          status.currentTime = kickVideo.currentTime;
          status.readyState = kickVideo.readyState;
          status.networkState = kickVideo.networkState;
          
          // Additional mobile-specific info
          status.hasDimensions = kickVideo.videoWidth > 0 && kickVideo.videoHeight > 0;
          status.src = kickVideo.src || null;
          status.srcType = kickVideo.src ? 
                         (kickVideo.src.startsWith('blob:') ? 'blob' : 'direct') : 
                         null;
        } else {
          // Fallback to generic video element
          const video = document.querySelector('video');
          if (video) {
            status.isPlaying = !video.paused && !video.ended && video.currentTime > 0 && video.readyState > 2;
            status.isPaused = video.paused;
            status.isBuffering = video.readyState < 3;
            status.isMuted = video.muted;
            status.volume = Math.round(video.volume * 100);
          } else {
            status.error = "No video player found";
          }
        }
        
        // Kick.com specific quality selectors
        const qualitySelectors = [
          '.quality-selector button',
          '.quality-selection-button',
          '.player-settings-menu .quality-option',
          '.vjs-resolution-button',
          '.video-quality-selector'
        ];
        
        for (const selector of qualitySelectors) {
          const element = document.querySelector(selector);
          if (element) {
            const text = element.innerText || element.textContent || '';
            if (text.includes('p') || text.includes('HD') || text.includes('SD')) {
              status.quality = text.trim();
              break;
            }
          }
        }
        
        // Kick.com specific error selectors
        const errorSelectors = [
          '.player-error',
          '.player-error-message',
          '.error-message',
          '.vjs-error-display',
          '.stream-error'
        ];
        
        for (const selector of errorSelectors) {
          const element = document.querySelector(selector);
          if (element && element.offsetParent !== null) { // Check if visible
            status.error = element.innerText || element.textContent || 'Unknown error';
            break;
          }
        }
        
        // Check for loading spinner (indicates buffering)
        const spinnerSelectors = [
          '.loading-spinner', 
          '.spinner', 
          '.vjs-loading-spinner',
          '[class*="loading"]',
          '[class*="buffering"]'
        ];
        
        for (const selector of spinnerSelectors) {
          const spinner = document.querySelector(selector);
          if (spinner && window.getComputedStyle(spinner).display !== 'none') {
            status.isBuffering = true;
            break;
          }
        }
        
        return status;
      } catch (error) {
        console.error('Error extracting playback status:', error);
        return { ...status, error: error.message };
      }
    });
  } catch (error) {
    logger.error(`Failed to extract Kick playback status: ${error.message}`);
    return { isPlaying: false, error: error.message };
  }
}

/**
 * Extract chat messages from the Kick.com stream page
 * @param {Object} page - Puppeteer page object
 * @returns {Array} - Chat messages
 */
async function extractKickChatMessages(page) {
  try {
    return await page.evaluate(() => {
      const chatMessages = [];
      
      try {
        // Kick.com specific chat container selectors
        const chatContainerSelectors = [
          '.chat-list',
          '.chat-messages-container',
          '.chat-list__message-container',
          '.chat-list__list-container',
          '.chatroom div[class*="scrollable"]'
        ];
        
        let chatContainer = null;
        for (const selector of chatContainerSelectors) {
          chatContainer = document.querySelector(selector);
          if (chatContainer) break;
        }
        
        if (!chatContainer) return chatMessages;
        
        // Kick.com specific message selectors
        const messageSelectors = [
          '.chat-entry',
          '.chat-message',
          '.message',
          '.chat-message-item',
          '.chat-list__message'
        ];
        
        let messageElements = [];
        for (const selector of messageSelectors) {
          messageElements = chatContainer.querySelectorAll(selector);
          if (messageElements.length > 0) break;
        }
        
        // Process the last 50 messages (or fewer if not that many)
        const start = Math.max(0, messageElements.length - 50);
        
        for (let i = start; i < messageElements.length; i++) {
          const messageEl = messageElements[i];
          
          // Extract username - Kick.com specific
          let username = '';
          const usernameEl = messageEl.querySelector('.chat-message-sender, .chat-entry__username, .chat-author, .username-container');
          if (usernameEl) {
            username = usernameEl.innerText || usernameEl.textContent || '';
          }
          
          // Extract message text - Kick.com specific
          let messageText = '';
          const textEl = messageEl.querySelector('.chat-message-content, .chat-entry__message, .message-content');
          if (textEl) {
            messageText = textEl.innerText || textEl.textContent || '';
          }
          
          // Skip empty messages
          if (!messageText) continue;
          
          // Extract timestamp if available
          let timestamp = Date.now();
          const timeEl = messageEl.querySelector('.chat-message-time, .chat-timestamp, .timestamp');
          if (timeEl) {
            const timeText = timeEl.innerText || timeEl.textContent || '';
            if (timeText) {
              // Try to parse time like "2:45 PM" or "14:45"
              const now = new Date();
              const timeParts = timeText.match(/(\d+):(\d+)(?:\s*(AM|PM))?/i);
              if (timeParts) {
                let hours = parseInt(timeParts[1]);
                const minutes = parseInt(timeParts[2]);
                
                if (timeParts[3]) {
                  // 12-hour format
                  if (timeParts[3].toUpperCase() === 'PM' && hours < 12) {
                    hours += 12;
                  } else if (timeParts[3].toUpperCase() === 'AM' && hours === 12) {
                    hours = 0;
                  }
                }
                
                timestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes).getTime();
              }
            }
          }
          
          // Check for badges/roles - Kick.com specific
          let isModerator = false;
          let isSubscriber = false;
          
          // Kick specific badge classes
          const badgeEls = messageEl.querySelectorAll('.badge, .chat-badge, .role-badge, .user-role-badge');
          for (const badgeEl of badgeEls) {
            const badgeText = badgeEl.innerText || badgeEl.textContent || '';
            const badgeClass = badgeEl.className || '';
            
            isModerator = isModerator || 
                           badgeText.includes('MOD') || 
                           badgeClass.includes('moderator') ||
                           badgeClass.includes('mod-badge') ||
                           badgeClass.includes('role-badge--moderator');
            
            isSubscriber = isSubscriber || 
                           badgeText.includes('SUB') || 
                           badgeClass.includes('subscriber') ||
                           badgeClass.includes('sub-badge') ||
                           badgeClass.includes('role-badge--subscriber');
          }
          
          chatMessages.push({
            username,
            message: messageText,
            timestamp,
            isModerator,
            isSubscriber
          });
        }
        
        return chatMessages;
      } catch (error) {
        console.error('Error extracting chat messages:', error);
        return [];
      }
    });
  } catch (error) {
    logger.error(`Failed to extract Kick chat messages: ${error.message}`);
    return [];
  }
}

/**
 * Simulate mobile-like interaction for Kick.com
 * @param {Object} page - Puppeteer page object
 */
async function simulateMobileInteraction(page) {
  try {
    // Mobile-specific interactions to keep Kick.com streams alive
    await page.evaluate(() => {
      try {
        // Function to create touch events
        function createTouchEvent(element, eventType) {
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
        
        // Find the video player
        const videoPlayer = document.querySelector('#video-player') || document.querySelector('video');
        if (videoPlayer) {
          // Touch the video player to keep it active
          createTouchEvent(videoPlayer, 'touchstart');
          setTimeout(() => createTouchEvent(videoPlayer, 'touchend'), 50);
          
          // Ensure player stays unmuted and at good volume
          if (videoPlayer.muted) videoPlayer.muted = false;
          videoPlayer.volume = 0.5;
          
          // Touch around the player slightly to simulate engagement
          const playerRect = videoPlayer.getBoundingClientRect();
          const touchPositions = [
            { x: playerRect.width * 0.25, y: playerRect.height * 0.25 },
            { x: playerRect.width * 0.75, y: playerRect.height * 0.75 },
            { x: playerRect.width * 0.5, y: playerRect.height * 0.5 }
          ];
          
          // Choose a random position
          const position = touchPositions[Math.floor(Math.random() * touchPositions.length)];
          
          // Create a touch at this position
          const touchElement = document.elementFromPoint(
            playerRect.left + position.x,
            playerRect.top + position.y
          );
          
          if (touchElement) {
            createTouchEvent(touchElement, 'touchstart');
            setTimeout(() => createTouchEvent(touchElement, 'touchend'), 50);
          }
          
          return true;
        }
        
        return false;
      } catch (error) {
        console.error('Error during mobile interaction:', error);
        return false;
      }
    });
    
    // Sometimes simulate a mobile scroll to keep the page active
    if (Math.random() < 0.3) {
      await page.evaluate(() => {
        const scrollAmount = Math.floor(Math.random() * 50) - 25; // Small scroll up or down
        window.scrollBy(0, scrollAmount);
      });
    }
  } catch (error) {
    logger.debug(`Error simulating mobile interaction: ${error.message}`);
    // Ignore errors
  }
}

/**
 * Fix Kick.com stream issues with mobile-focused approach
 * @param {string} viewerId - ID of the viewer
 * @param {Map} browserInstances - Map of browser instances
 * @param {Map} failedAttempts - Map of failed attempts
 * @param {Function} startViewer - Function to start a viewer
 * @param {Function} stopViewer - Function to stop a viewer
 * @param {Function} takeScreenshot - Function to take a screenshot
 * @param {Function} saveViewerWithLock - Function to save a viewer with lock
 * @param {string} screenshotsDir - Directory for screenshots
 */
async function fixKickStreamIssues(viewerId, browserInstances, failedAttempts, startViewer, stopViewer, takeScreenshot, saveViewerWithLock, screenshotsDir) {
  try {
    const { page } = browserInstances.get(viewerId.toString());
    logger.info(`Attempting to fix Kick.com stream issues for viewer ${viewerId}`);
    
    // First check if there's a 403 Forbidden error
    const has403Error = await page.evaluate(() => {
      return document.body.innerText.includes('403') || 
             document.body.innerText.includes('Forbidden') ||
             document.body.innerText.includes('Access Denied');
    });
    
    if (has403Error) {
      logger.warn(`403 Forbidden detected during stream - Kick's bot protection triggered`);
      
      // Take a screenshot for debugging
      const filename = `${viewerId}-403forbidden-${Date.now()}.png`;
      const screenshotPath = path.join(screenshotsDir, filename);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      
      // Update counter and try to reload
      failedAttempts.set(viewerId, (failedAttempts.get(viewerId) || 0) + 1);
      
      // Reload the page
      await page.goto(page.url(), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      
      // Check if still has 403
      const stillHas403 = await page.evaluate(() => {
        return document.body.innerText.includes('403') || 
               document.body.innerText.includes('Forbidden') ||
               document.body.innerText.includes('Access Denied');
      });
      
      if (stillHas403) {
        // If we've had too many failures, we need to restart with a fresh fingerprint
        if ((failedAttempts.get(viewerId) || 0) > 2) {
          logger.error(`Too many 403 errors, restarting with fresh fingerprint`);
          
          // Update viewer status
          const viewer = await Viewer.findById(viewerId);
          viewer.error = "Kick.com bot protection - restarting with fresh fingerprint";
          await saveViewerWithLock(viewer);
          
          // Stop and restart with fresh fingerprint
          await stopViewer(viewerId);
          setTimeout(() => {
            startViewer(viewerId).catch(e => 
              logger.error(`Failed to restart viewer after 403: ${e.message}`)
            );
          }, 5000);
          
          return false;
        }
      }
    }
    
    // Use mobile-specific video recovery techniques
    const videoFixed = await page.evaluate(() => {
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
        
        // APPROACH 1: Try to find and fix video element
        const kickVideo = document.querySelector('#video-player');
        if (kickVideo) {
          console.log("Applying mobile video recovery techniques to Kick player");
          
          // Check video state
          const wasPlaying = !kickVideo.paused;
          const wasMuted = kickVideo.muted;
          const currentTime = kickVideo.currentTime;
          
          // Create touch events to activate the player
          createAndDispatchTouchEvent(kickVideo, 'touchstart');
          setTimeout(() => {
            createAndDispatchTouchEvent(kickVideo, 'touchend');
            
            // Mobile-specific: sometimes there's an overlay blocking interaction
            const overlays = document.querySelectorAll('.overlay, .player-overlay, [class*="overlay"]');
            for (const overlay of overlays) {
              createAndDispatchTouchEvent(overlay, 'touchstart');
              setTimeout(() => createAndDispatchTouchEvent(overlay, 'touchend'), 100);
            }
            
            // Try to play
            kickVideo.play().catch(e => {
              console.warn("Direct play failed, trying with mobile workarounds:", e);
              
              // First try with muted
              kickVideo.muted = true;
              kickVideo.play().then(() => {
                // Success with muted, now try to unmute
                setTimeout(() => {
                  kickVideo.muted = false;
                  console.log("Unmuted after recovery");
                }, 1000);
              }).catch(e2 => {
                console.error("Even muted play failed, trying reload:", e2);
                
                // If that fails, try reloading the video
                kickVideo.load();
                kickVideo.currentTime = currentTime > 5 ? currentTime - 5 : 0;
                
                // After reload, try again
                setTimeout(() => {
                  kickVideo.play().catch(e3 => console.error("Final play attempt failed:", e3));
                }, 1000);
              });
            });
          }, 100);
          
          return true;
        }
        
        // APPROACH 2: Try to click play buttons
        const playButtons = document.querySelectorAll(
          '.play-button, .vjs-big-play-button, .player-control-playpause, .player__play-button, ' +
          '[aria-label="Play"], button.play, .control-icon-container[class*="play"]'
        );
        
        if (playButtons.length > 0) {
          console.log(`Found ${playButtons.length} play buttons, clicking them`);
          
          for (const button of playButtons) {
            createAndDispatchTouchEvent(button, 'touchstart');
            setTimeout(() => createAndDispatchTouchEvent(button, 'touchend'), 100);
          }
          
          return true;
        }
        
        // APPROACH 3: Look for stalled message and retry
        const errorMessages = document.querySelectorAll('.error-message, .player-error, .stalled-message');
        if (errorMessages.length > 0) {
          console.log("Found error messages, looking for retry buttons");
          
          // Look for retry buttons
          const retryButtons = document.querySelectorAll(
            'button[class*="retry"], button[class*="reload"], [class*="try-again"]'
          );
          
          if (retryButtons.length > 0) {
            for (const button of retryButtons) {
              createAndDispatchTouchEvent(button, 'touchstart');
              setTimeout(() => createAndDispatchTouchEvent(button, 'touchend'), 100);
            }
            return true;
          }
        }
        
        return false;
      } catch (e) {
        console.error("Error in fixKickStreamIssues:", e);
        return false;
      }
    });
    
    // If that didn't work, try reloading the page
    if (!videoFixed) {
      logger.info("Mobile video fix attempts didn't work, trying page reload");
      
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      
      // Handle page barriers again
      await handleKickPageBarriers(page);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error fixing Kick stream issues: ${error.message}`);
    return false;
  }
}

module.exports = {
  setupKickRequestInterception,
  handleKickPageBarriers,
  checkKickStreamStatus,
  extractKickMetadata,
  extractKickPlaybackStatus,
  extractKickChatMessages,
  simulateMobileInteraction,
  fixKickStreamIssues
};