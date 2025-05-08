// services/browserUtils.js
const randomUseragent = require('random-useragent');
const fingerprint = require('../utils/fingerprint');
const config = require('../config/config');
const logger = require('../utils/logger');

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

module.exports = {
  getTimezoneString,
  generateMobileFingerprint,
  applyMobileFingerprinting
};