// services/puppeteerService.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AnonymizeUAPlugin = require('puppeteer-extra-plugin-anonymize-ua');
const randomUseragent = require('random-useragent');
const cheerio = require('cheerio');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Viewer = require('../models/Viewer');
const Stream = require('../models/Stream');
const Box = require('../models/Box');
const logger = require('../utils/logger');
const config = require('../config/config');
const fingerprint = require('../utils/fingerprint');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;

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
  
  try {
    // Perform the save
    await viewer.save();
    resolveLock();
    return viewer;
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

// Export the saveViewerWithLock function
exports.saveViewerWithLock = saveViewerWithLock;

/**
 * Get a realistic timezone string based on offset
 * @param {number} offset - Timezone offset in hours
 * @returns {string} - IANA timezone string
 */
function getTimezoneString(offset) {
  // Convert timezone offset to IANA timezone
  const timezoneMap = {
    "-12": "Etc/GMT+12", // Note: IANA uses opposite sign for Etc/GMT
    "-11": "Etc/GMT+11",
    "-10": "Pacific/Honolulu",
    "-9": "America/Anchorage",
    "-8": "America/Los_Angeles",
    "-7": "America/Denver",
    "-6": "America/Chicago",
    "-5": "America/New_York",
    "-4": "America/Halifax",
    "-3": "America/Sao_Paulo",
    "-2": "Etc/GMT+2",
    "-1": "Etc/GMT+1",
    "0": "Etc/GMT",
    "1": "Europe/Paris",
    "2": "Europe/Kiev",
    "3": "Europe/Moscow",
    "4": "Asia/Dubai",
    "5": "Asia/Karachi",
    "5.5": "Asia/Kolkata",
    "6": "Asia/Dhaka",
    "7": "Asia/Bangkok",
    "8": "Asia/Shanghai",
    "9": "Asia/Tokyo",
    "10": "Australia/Sydney",
    "11": "Pacific/Noumea",
    "12": "Pacific/Auckland",
    "13": "Pacific/Apia"
  };
  
  // Convert offset to string and handle fractional hours
  const offsetStr = offset.toString();
  
  // Return the mapped timezone or a default
  return timezoneMap[offsetStr] || "Etc/GMT";
}

/**
 * Generate mobile-focused fingerprint for better Kick.com compatibility
 * @returns {Object} - Browser fingerprint object
 */
function generateMobileFingerprint() {
  // Start with the base fingerprint
  const baseFingerprint = fingerprint.generateRandomFingerprint(config.viewer.fingerprintOptions);
  
  // Mobile OS distributions - focused on ones that work well with Kick
  const mobilePlatforms = [
    {
      osFamily: "Android",
      osVersion: "13",
      browserName: "Chrome",
      browserVersions: ["110.0.5481.177", "111.0.5563.64", "112.0.5615.49", "113.0.5672.93", "114.0.5735.106"],
      screenResolutions: [
        {width: 412, height: 915}, // Pixel 6
        {width: 360, height: 800}, // Samsung Galaxy
        {width: 414, height: 896}, // iPhone XR/11 (but we're using Android)
        {width: 393, height: 873}, // Pixel 5
        {width: 412, height: 892}  // OnePlus 9
      ]
    },
    {
      osFamily: "iOS",
      osVersion: "16.5",
      browserName: "Safari",
      browserVersions: ["16.0", "16.1", "16.3", "16.5"],
      screenResolutions: [
        {width: 390, height: 844}, // iPhone 13/14
        {width: 428, height: 926}, // iPhone 13/14 Pro Max
        {width: 414, height: 896}, // iPhone 11
        {width: 375, height: 812}  // iPhone X/XS
      ]
    }
  ];
  
  // Choose a random mobile platform (80% Android, 20% iOS since Android works better)
  const platformChoice = Math.random() < 0.8 ? 0 : 1;
  const platform = mobilePlatforms[platformChoice];
  
  // Select browser version and screen resolution
  const browserVersion = platform.browserVersions[Math.floor(Math.random() * platform.browserVersions.length)];
  const screenResolution = platform.screenResolutions[Math.floor(Math.random() * platform.screenResolutions.length)];
  
  // Sometimes flip to landscape which works better for viewing
  const isLandscape = Math.random() < 0.6; // 60% chance for landscape
  if (isLandscape) {
    const temp = screenResolution.width;
    screenResolution.width = screenResolution.height;
    screenResolution.height = temp;
  }
  
  // Generate appropriate User-Agent
  let userAgent;
  if (platform.osFamily === "Android") {
    userAgent = `Mozilla/5.0 (Linux; Android ${platform.osVersion}; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browserVersion} Mobile Safari/537.36`;
  } else {
    userAgent = `Mozilla/5.0 (iPhone; CPU iPhone OS ${platform.osVersion.replace('.', '_')} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${browserVersion} Mobile/15E148 Safari/604.1`;
  }
  
  // Create enhanced fingerprint with mobile focus
  const mobileFingerprint = {
    ...baseFingerprint,
    userAgent,
    osFamily: platform.osFamily,
    osVersion: platform.osVersion,
    browserName: platform.browserName,
    browserVersion: browserVersion,
    screenResolution,
    colorDepth: 24,
    deviceMemory: [2, 3, 4, 6][Math.floor(Math.random() * 4)], // Mobile devices typically have less memory
    hardwareConcurrency: [4, 6, 8][Math.floor(Math.random() * 3)], // Mobile devices typically have fewer cores
    platform: platform.osFamily === "Android" ? "Android" : "iPhone",
    language: ["en-US", "en-GB", "fr-FR", "de-DE", "es-ES", "it-IT", "ja-JP", "ko-KR", "pt-BR"][Math.floor(Math.random() * 9)],
    doNotTrack: Math.random() > 0.9 ? "1" : null, // Most mobile browsers don't have DNT enabled
    cookieEnabled: true, // Mobile browsers almost always have cookies enabled
    timezone: Math.floor(Math.random() * 25) - 12, // -12 to +12
    timezoneString: "",
    plugins: [], // Mobile browsers typically don't expose plugins
    touchSupported: true,
    maxTouchPoints: platform.osFamily === "iOS" ? 5 : [1, 2, 5][Math.floor(Math.random() * 3)],
    webdriver: false,
    webgl: {
      vendor: platform.osFamily === "iOS" ? "Apple GPU" : "Google SwiftShader",
      renderer: platform.osFamily === "iOS" ? "Apple GPU" : "Google SwiftShader"
    },
    hasTouch: true,
    isMobile: true,
    isAndroid: platform.osFamily === "Android",
    isIOS: platform.osFamily === "iOS",
    isLandscape: isLandscape
  };
  
  // Set timezone string based on timezone offset
  mobileFingerprint.timezoneString = getTimezoneString(mobileFingerprint.timezone);
  
  return mobileFingerprint;
}

/**
 * Apply comprehensive fingerprinting to a page with mobile focus
 * @param {Object} page - Puppeteer page object
 * @param {Object} fingerprint - Fingerprint configuration
 */
async function applyMobileFingerprinting(page, fingerprint) {
  // Set extra HTTP headers - but REMOVE upgrade-insecure-requests which causes CORS issues
  await page.setExtraHTTPHeaders({
    'Accept-Language': fingerprint.language,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Sec-Fetch-Dest': 'document',
    // Removed 'Upgrade-Insecure-Requests' header as it causes CORS issues
    'sec-ch-ua': `"${fingerprint.browserName}";v="${fingerprint.browserVersion}", "Not_A Brand";v="99"`,
    'sec-ch-ua-mobile': '?1', // Always set to mobile
    'sec-ch-ua-platform': `"${fingerprint.osFamily}"`
  });
  
  // Emulate timezone
  await page.emulateTimezone(fingerprint.timezoneString);
  
  // Advanced fingerprint evasion
  await page.evaluateOnNewDocument((fp) => {
    // Override navigator properties
    const originalNavigator = window.navigator;
    const navigatorProxy = new Proxy(originalNavigator, {
      get: function(target, property) {
        switch (property) {
          case 'userAgent':
            return fp.userAgent;
          case 'appVersion':
            return fp.userAgent.substring(8);
          case 'platform':
            return fp.platform;
          case 'language':
            return fp.language;
          case 'languages':
            return [fp.language, fp.language.split('-')[0]];
          case 'deviceMemory':
            return fp.deviceMemory;
          case 'hardwareConcurrency':
            return fp.hardwareConcurrency;
          case 'cookieEnabled':
            return fp.cookieEnabled;
          case 'doNotTrack':
            return fp.doNotTrack;
          case 'webdriver':
            return false;
          case 'maxTouchPoints':
            return fp.maxTouchPoints;
          // Mobile specific properties
          case 'userAgentData':
            return {
              brands: [
                { brand: fp.browserName, version: fp.browserVersion.split('.')[0] },
                { brand: 'Not.A.Brand', version: '24' }
              ],
              mobile: true,
              platform: fp.osFamily
            };
          default:
            // Call the native navigator for methods and other properties
            const value = target[property];
            return typeof value === 'function' ? value.bind(target) : value;
        }
      }
    });
    
    // Replace navigator globally
    Object.defineProperty(window, 'navigator', {
      value: navigatorProxy,
      writable: false,
      configurable: false
    });
    
    // Override screen properties for mobile
    const screenProxy = new Proxy(window.screen, {
      get: function(target, property) {
        switch (property) {
          case 'width':
            return fp.screenResolution.width;
          case 'height':
            return fp.screenResolution.height;
          case 'availWidth':
            return fp.screenResolution.width;
          case 'availHeight':
            return fp.screenResolution.height - (fp.isIOS ? 40 : 48); // iOS vs Android status bar
          case 'colorDepth':
            return fp.colorDepth;
          case 'pixelDepth':
            return fp.colorDepth;
          case 'orientation':
            return {
              type: fp.isLandscape ? 'landscape-primary' : 'portrait-primary',
              angle: fp.isLandscape ? 90 : 0
            };
          default:
            const value = target[property];
            return typeof value === 'function' ? value.bind(target) : value;
        }
      }
    });
    
    Object.defineProperty(window, 'screen', {
      value: screenProxy,
      writable: false,
      configurable: false
    });
    
    // Mobile specific - override matchMedia for orientation
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = function(query) {
      if (query.includes('orientation')) {
        const isPortraitQuery = query.includes('portrait');
        const isLandscapeQuery = query.includes('landscape');
        
        if ((isPortraitQuery && !fp.isLandscape) || (isLandscapeQuery && fp.isLandscape)) {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener: function() {},
            removeListener: function() {},
            addEventListener: function() {},
            removeEventListener: function() {},
            dispatchEvent: function() { return true; }
          };
        } else {
          return {
            matches: false,
            media: query,
            onchange: null,
            addListener: function() {},
            removeListener: function() {},
            addEventListener: function() {},
            removeEventListener: function() {},
            dispatchEvent: function() { return true; }
          };
        }
      }
      
      // For other queries, use the original implementation
      return originalMatchMedia.call(window, query);
    };
    
    // Mobile specific - add touch events
    if (typeof TouchEvent !== 'undefined') {
      // Don't override if the browser already supports touch events
    } else {
      // Simple mock for touch events if not available
      window.TouchEvent = function TouchEvent(type, options) {
        return new Event(type, options);
      };
      window.Touch = function Touch(options) {
        this.identifier = options.identifier || 0;
        this.target = options.target || null;
        this.clientX = options.clientX || 0;
        this.clientY = options.clientY || 0;
        this.screenX = options.screenX || 0;
        this.screenY = options.screenY || 0;
        this.pageX = options.pageX || 0;
        this.pageY = options.pageY || 0;
      };
    }
    
    // Modify Date behavior for consistent timezone emulation
    const originalDate = Date;
    const dateProxy = new Proxy(originalDate, {
      construct: function(target, args) {
        const date = new target(...args);
        const timezoneOffset = fp.timezone * 60;
        
        const originalGetTimezoneOffset = date.getTimezoneOffset;
        date.getTimezoneOffset = function() {
          return timezoneOffset;
        };
        
        return date;
      }
    });
    
    window.Date = dateProxy;
    
    // WebGL rendering for mobile
    if (window.WebGLRenderingContext) {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        // UNMASKED_VENDOR_WEBGL
        if (parameter === 37445) {
          return fp.webgl.vendor;
        }
        // UNMASKED_RENDERER_WEBGL
        if (parameter === 37446) {
          return fp.webgl.renderer;
        }
        return getParameter.call(this, parameter);
      };
    }
    
    // Mobile specific - override devicePixelRatio
    Object.defineProperty(window, 'devicePixelRatio', {
      get: function() {
        // Mobile devices typically have higher pixel ratios
        return fp.isIOS ? 3 : 2.75;
      },
      configurable: true
    });
    
    // Mobile specific - override ontouchstart
    Object.defineProperty(window, 'ontouchstart', {
      get: function() {
        return null;
      },
      set: function() {},
      configurable: true
    });
    
    // Add event-related overrides for mobile
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      // For touch events like touchstart, touchmove, touchend
      // We let them pass through normally for mobile emulation
      return originalAddEventListener.call(this, type, listener, options);
    };
    
    // Override performance API to prevent timing attacks
    if (window.performance && window.performance.now) {
      const originalNow = window.performance.now;
      window.performance.now = function() {
        // Add small random noise to prevent precise timing analysis
        const noise = Math.random() * 0.1;
        return originalNow.call(this) + noise;
      };
    }
    
    // Override battery API to provide consistent values for mobile
    if (navigator.getBattery) {
      navigator.getBattery = function() {
        return Promise.resolve({
          charging: Math.random() > 0.5, // Mobile devices are often plugged in
          chargingTime: Math.random() > 0.5 ? Infinity : Math.floor(Math.random() * 7200),
          dischargingTime: Math.floor(Math.random() * 14400) + 3600, // More realistic for mobile
          level: 0.3 + Math.random() * 0.6, // 30-90% is typical
          addEventListener: function() {},
          removeEventListener: function() {}
        });
      };
    }
    
    // Mobile specific - Connection API
    if (navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: function() {
          return {
            effectiveType: ['4g', '3g'][Math.floor(Math.random() * 2)],
            rtt: Math.floor(Math.random() * 100) + 50,
            downlink: Math.floor(Math.random() * 10) + 2,
            saveData: false // Most mobile users don't enable data saving
          };
        }
      });
    } else {
      // Add connection API if not present (some browsers)
      Object.defineProperty(navigator, 'connection', {
        value: {
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
          saveData: false
        }
      });
    }
    
    // Mobile specific - add mediaDevices with overrides
    if (navigator.mediaDevices) {
      const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
      navigator.mediaDevices.enumerateDevices = function() {
        return Promise.resolve([
          {
            deviceId: 'default',
            kind: 'videoinput',
            label: 'Front Camera',
            groupId: 'camera-group'
          },
          {
            deviceId: 'rear',
            kind: 'videoinput',
            label: 'Back Camera',
            groupId: 'camera-group'
          },
          {
            deviceId: 'default',
            kind: 'audioinput',
            label: 'Microphone',
            groupId: 'audio-group'
          },
          {
            deviceId: 'default',
            kind: 'audiooutput',
            label: 'Speaker',
            groupId: 'audio-group'
          }
        ]);
      };
    }
    
    // Create consistent canvas fingerprint (important for Kick.com)
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
      // For fingerprinting canvases, add slight random noise
      const canvas = this;
      if (canvas.width > 16 && canvas.height > 16) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Add subtle noise to prevent fingerprinting
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            // Skip text areas to maintain readability
            const alpha = data[i+3];
            if (alpha !== 0 && alpha !== 255) continue;
              
            data[i] = data[i] + Math.floor(Math.random() * 3) - 1;     // Red
            data[i+1] = data[i+1] + Math.floor(Math.random() * 3) - 1; // Green
            data[i+2] = data[i+2] + Math.floor(Math.random() * 3) - 1; // Blue
          }
          ctx.putImageData(imageData, 0, 0);
        }
      }
      return originalToDataURL.call(this, type, quality);
    };
    
    // Special handling for websockets for Kick.com
    if (window.WebSocket) {
      const OriginalWebSocket = window.WebSocket;
      window.WebSocket = function(url, protocols) {
        // Special handling for Kick.com websockets
        if (url.includes('kick.com')) {
          console.log('Connecting to Kick websocket:', url);
          // We just pass it through, our request interceptor will handle headers
        }
        return new OriginalWebSocket(url, protocols);
      };
      window.WebSocket.prototype = OriginalWebSocket.prototype;
      window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
      window.WebSocket.OPEN = OriginalWebSocket.OPEN;
      window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
      window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
    }
    
    // NoScript/Content-Security
    Object.defineProperty(document, 'currentScript', {
      get() {
        return null;
      }
    });
    
    // Special handling for Fetch API - mobile specific headers
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      if (init && init.headers) {
        // Process the headers
        const modifiedInit = { ...init };
        
        // If using Headers object, convert to plain object
        if (modifiedInit.headers instanceof Headers) {
          const plainHeaders = {};
          for (const [key, value] of modifiedInit.headers.entries()) {
            plainHeaders[key] = value;
          }
          modifiedInit.headers = plainHeaders;
        }
        
        // Convert to object if it's an array
        if (Array.isArray(modifiedInit.headers)) {
          const plainHeaders = {};
          for (const [key, value] of modifiedInit.headers) {
            plainHeaders[key] = value;
          }
          modifiedInit.headers = plainHeaders;
        }
        
        // Remove problematic headers for CORS
        if (typeof modifiedInit.headers === 'object') {
          delete modifiedInit.headers['upgrade-insecure-requests'];
          
          // Add common mobile headers if not present
          if (!modifiedInit.headers['sec-ch-ua-mobile']) {
            modifiedInit.headers['sec-ch-ua-mobile'] = '?1';
          }
          
          // Convert back to Headers object
          const headers = new Headers();
          for (const [key, value] of Object.entries(modifiedInit.headers)) {
            headers.append(key, value);
          }
          modifiedInit.headers = headers;
        }
        
        return originalFetch.call(window, input, modifiedInit);
      }
      
      return originalFetch.call(window, input, init);
    };
    
    // XMLHttpRequest header manipulation (for Kick.com)
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    
    XMLHttpRequest.prototype.open = function(method, url) {
      this._url = url;
      return originalXHROpen.apply(this, arguments);
    };
    
    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
      // Skip problematic headers for Kick.com
      if (header.toLowerCase() === 'upgrade-insecure-requests') {
        return;
      }
      return originalXHRSetRequestHeader.call(this, header, value);
    };
    
    // Special handling for HLS.js that Kick.com uses
    if (window.Hls && window.Hls.DefaultConfig) {
      window.Hls.DefaultConfig.xhrSetup = function(xhr, url) {
        // Set any required headers here for HLS.js requests
        // But don't add upgrade-insecure-requests
      };
    }
    
    // Set default media session
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Live Stream',
        artist: 'Kick.com',
        album: 'Live Stream',
        artwork: []
      });
    }
  }, fingerprint);
  
  // Add mobile-specific gestures and behaviors
  await page.evaluateOnNewDocument(() => {
    // Helper to create synthetic touch events
    function createTouchEvent(element, eventType) {
      if (!element) return;
      
      // Create touch points
      const rect = element.getBoundingClientRect();
      const touch = new Touch({
        identifier: Date.now(),
        target: element,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        screenX: rect.left + rect.width / 2,
        screenY: rect.top + rect.height / 2,
        pageX: rect.left + rect.width / 2 + window.scrollX,
        pageY: rect.top + rect.height / 2 + window.scrollY
      });
      
      // Create touch event
      const touchEvent = new TouchEvent(eventType, {
        bubbles: true,
        cancelable: true,
        view: window,
        touches: eventType === 'touchend' ? [] : [touch],
        targetTouches: eventType === 'touchend' ? [] : [touch],
        changedTouches: [touch]
      });
      
      // Dispatch event
      element.dispatchEvent(touchEvent);
    }
    
    // Add to window for use in other contexts
    window.createTouchEvent = createTouchEvent;
    
    // Override HTMLVideoElement for better mobile compatibility
    if (window.HTMLVideoElement) {
      const originalPlay = HTMLVideoElement.prototype.play;
      HTMLVideoElement.prototype.play = function() {
        // Check if it's a Kick.com video player
        if (this.id === 'video-player' || 
            this.parentElement?.classList.contains('player-no-controls') ||
            this.closest('[class*="player"]')) {
          console.log("Enhanced mobile video play initiated");
          
          // Make sure autoplay attributes are set
          this.autoplay = true;
          this.muted = false;
          this.playsInline = true;
          
          // Create video settings that work well on mobile
          this.volume = 0.5;
          this.controls = true;
          
          // Add event listener to handle stalled/freeze issues
          this.addEventListener('stalled', function() {
            console.log("Video stalled, attempting recovery");
            const currentTime = this.currentTime;
            this.load();
            this.currentTime = currentTime;
            originalPlay.call(this).catch(e => console.error("Recovery play failed:", e));
          }, { once: true });
          
          // Mobile devices often need an initial touch to allow video playback
          createTouchEvent(this, 'touchstart');
          createTouchEvent(this, 'touchend');
        }
        
        return originalPlay.call(this).catch(error => {
          console.error("Video play error:", error);
          
          // If autoplay was blocked, try with muted first, then unmute
          if (error.name === 'NotAllowedError') {
            console.log("Attempting muted playback first");
            this.muted = true;
            return originalPlay.call(this).then(() => {
              // Successfully started muted, now try to unmute
              setTimeout(() => {
                console.log("Attempting to unmute");
                this.muted = false;
              }, 1000);
            }).catch(e => {
              console.error("Muted play also failed:", e);
              return Promise.reject(e);
            });
          }
          
          return Promise.reject(error);
        });
      };
    }
  });
}

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
 * Start a viewer specifically optimized for Kick.com
 * @param {string} viewerId - ID of the viewer
 * @returns {Promise<boolean>} - Success status
 */
exports.startViewer = async (viewerId) => {
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
  const browserFingerprint = generateMobileFingerprint();
  
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
    await applyMobileFingerprinting(page, browserFingerprint);
    
    // Set up request interception specially tuned for Kick.com
    await setupKickRequestInterception(page);
    
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
            await exports.startViewer(viewerId);
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
    await handleKickPageBarriers(page);
    
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
        return exports.startViewer(viewerId);
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
            video.playsInline = true;
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
    const isLive = await checkKickStreamStatus(page);
    if (!isLive) {
      logger.warn(`Stream ${viewer.streamUrl} appears to be offline for viewer ${viewer.name}`);
    } else {
      logger.info(`Stream ${viewer.streamUrl} is live for viewer ${viewer.name}`);
    }
    
    // Extract stream information
    const streamMetadata = await extractKickMetadata(page);
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
      await exports.takeScreenshot(viewerId);
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
};

/**
 * Stop a viewer
 * @param {string} viewerId - ID of the viewer to stop
 * @returns {Promise<boolean>} - Success status
 */
exports.stopViewer = async (viewerId) => {
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
};

/**
 * Take a screenshot of what the viewer is seeing
 * @param {string} viewerId - ID of the viewer
 * @returns {Promise<string>} - Path to the screenshot
 */
exports.takeScreenshot = async (viewerId) => {
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
};

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
      await simulateMobileInteraction(page);
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
    const isLive = await checkKickStreamStatus(page);
    
    // Extract stream metadata
    const streamMetadata = await extractKickMetadata(page);
    
    // Extract playback status
    const playbackStatus = await extractKickPlaybackStatus(page);
    
    // Extract chat messages if this viewer has chat parsing enabled
    if (viewer.isParseChatEnabled) {
      try {
        const chatMessages = await extractKickChatMessages(page);
        
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
        await exports.takeScreenshot(viewerId);
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
      await fixKickStreamIssues(viewerId);
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
 */
async function fixKickStreamIssues(viewerId) {
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
          await exports.stopViewer(viewerId);
          setTimeout(() => {
            exports.startViewer(viewerId).catch(e => 
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

/**
 * Force refresh a Kick.com stream to recover from issues
 * @param {string} viewerId - ID of the viewer
 */
exports.forceRefreshKickStream = async (viewerId) => {
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
    await handleKickPageBarriers(page);
    
    // Check if stream is now playing
    const playbackStatus = await extractKickPlaybackStatus(page);
    
    // Update viewer status
    viewer.status = 'running';
    viewer.playbackStatus = playbackStatus;
    viewer.lastActivityAt = new Date();
    await saveViewerWithLock(viewer);
    
    logger.info(`Force refresh completed for viewer ${viewer.name}`);
    
    // Take a screenshot to confirm state
    try {
      await exports.takeScreenshot(viewerId);
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
};

// Export helper functions and interval management
module.exports = {
  startViewer: exports.startViewer,
  navigateToStream: exports.navigateToStream,
  stopViewer: exports.stopViewer,
  takeScreenshot: exports.takeScreenshot,
  forceRefreshKickStream: exports.forceRefreshKickStream,
  saveViewerWithLock,
  startUpdateInterval,
  clearUpdateInterval,
  updateViewerData,
  applyMobileFingerprinting,
  generateMobileFingerprint,
  extractKickMetadata,
  checkKickStreamStatus,
  handleKickPageBarriers,
  setupKickRequestInterception,
  extractKickPlaybackStatus,
  extractKickChatMessages,
  simulateMobileInteraction,
  fixKickStreamIssues,
  getTimezoneString
};