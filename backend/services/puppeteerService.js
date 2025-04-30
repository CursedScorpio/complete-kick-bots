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

// Add near the top of the file, after the existing imports and constant declarations
// Map to store save locks for viewers to prevent concurrent saves
const saveLocks = new Map();

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
 * Generate a sophisticated browser fingerprint
 * @returns {Object} - Browser fingerprint object
 */
function generateAdvancedFingerprint() {
  // Use the existing fingerprint generator but enhance it
  const baseFingerprint = fingerprint.generateRandomFingerprint(config.viewer.fingerprintOptions);
  
  // OS and browser distributions - more realistic combinations
  const osFamilies = {
    "Windows": ["Windows 10", "Windows 11"],
    "macOS": ["macOS 10.15", "macOS 11", "macOS 12", "macOS 13"],
    "Linux": ["Ubuntu 20.04", "Ubuntu 22.04", "Fedora 37"],
    "Android": ["Android 12", "Android 13"],
    "iOS": ["iOS 16", "iOS 17"]
  };
  
  const browserVersions = {
    "Chrome": ["110.0.5481.177", "111.0.5563.64", "112.0.5615.49", "113.0.5672.93", "114.0.5735.106"],
    "Firefox": ["109.0", "110.0", "111.0", "112.0", "113.0"],
    "Safari": ["15.6.1", "16.0", "16.1", "16.2", "16.3"],
    "Edge": ["110.0.1587.50", "111.0.1661.44", "112.0.1722.34", "113.0.1774.35"]
  };
  
  // Select a random OS family and version
  const osFamily = Object.keys(osFamilies)[Math.floor(Math.random() * Object.keys(osFamilies).length)];
  const osVersion = osFamilies[osFamily][Math.floor(Math.random() * osFamilies[osFamily].length)];
  
  // Select appropriate browser for the OS
  let browserName;
  if (osFamily === "iOS") {
    browserName = "Safari";
  } else if (osFamily === "Android") {
    browserName = Math.random() > 0.3 ? "Chrome" : "Samsung Internet";
  } else {
    // Desktop OS - distribute browsers realistically
    const rand = Math.random();
    if (rand < 0.65) {
      browserName = "Chrome";
    } else if (rand < 0.85) {
      browserName = "Firefox";
    } else if (rand < 0.95) {
      browserName = "Edge";
    } else {
      browserName = osFamily === "macOS" ? "Safari" : "Opera";
    }
  }
  
  // Get appropriate browser version
  const browserVersion = browserVersions[browserName] ? 
    browserVersions[browserName][Math.floor(Math.random() * browserVersions[browserName].length)] :
    "100.0";
  
  // Generate realistic screen resolutions based on device type
  let screenResolution;
  if (osFamily === "iOS" || osFamily === "Android") {
    // Mobile resolutions
    const mobileResolutions = [
      {width: 414, height: 896},  // iPhone XR/11
      {width: 390, height: 844},  // iPhone 12/13/14
      {width: 428, height: 926},  // iPhone 13/14 Pro Max
      {width: 360, height: 800},  // Samsung Galaxy
      {width: 412, height: 915},  // Pixel 6
      {width: 360, height: 780}   // Common Android
    ];
    screenResolution = mobileResolutions[Math.floor(Math.random() * mobileResolutions.length)];
    // Sometimes flip to landscape
    if (Math.random() < 0.3) {
      const temp = screenResolution.width;
      screenResolution.width = screenResolution.height;
      screenResolution.height = temp;
    }
  } else {
    // Desktop resolutions
    const desktopResolutions = [
      {width: 1920, height: 1080},  // Full HD
      {width: 1366, height: 768},   // Common laptop
      {width: 1440, height: 900},   // MacBook
      {width: 2560, height: 1440},  // 2K
      {width: 1280, height: 800},   // Small laptop
      {width: 3840, height: 2160}   // 4K
    ];
    screenResolution = desktopResolutions[Math.floor(Math.random() * desktopResolutions.length)];
  }
  
  // Generate User-Agent based on selected platform
  let userAgent;
  // For accurate user agents, we'd use a comprehensive library or service
  // Here we'll rely on randomUseragent but filter by the chosen browser and OS
  const browserFilter = new RegExp(browserName, 'i');
  const osFilter = new RegExp(osFamily, 'i');
  
  for (let i = 0; i < 10; i++) {
    const candidate = randomUseragent.getRandom();
    if (browserFilter.test(candidate) && osFilter.test(candidate)) {
      userAgent = candidate;
      break;
    }
  }
  
  // If no matching user agent found, create a generic one based on the chosen browser and OS
  if (!userAgent) {
    if (browserName === "Chrome") {
      userAgent = `Mozilla/5.0 (${osFamily === "Windows" ? "Windows NT 10.0; Win64; x64" : 
        osFamily === "macOS" ? "Macintosh; Intel Mac OS X 10_15_7" : 
        osFamily === "Linux" ? "X11; Linux x86_64" : 
        osFamily === "Android" ? "Android 13; Mobile" : 
        "iPhone; CPU iPhone OS 16_0 like Mac OS X"}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browserVersion} Safari/537.36`;
    } else if (browserName === "Firefox") {
      userAgent = `Mozilla/5.0 (${osFamily === "Windows" ? "Windows NT 10.0; Win64; x64" : 
        osFamily === "macOS" ? "Macintosh; Intel Mac OS X 10.15" : 
        osFamily === "Linux" ? "X11; Linux x86_64" : 
        osFamily === "Android" ? "Android 13; Mobile" : 
        "iPhone; CPU iPhone OS 16_0 like Mac OS X"}; rv:109.0) Gecko/20100101 Firefox/${browserVersion}`;
    } else {
      userAgent = randomUseragent.getRandom();
    }
  }
  
  // Create enhanced fingerprint
  const enhancedFingerprint = {
    ...baseFingerprint,
    userAgent,
    osFamily,
    osVersion,
    browserName,
    browserVersion,
    screenResolution,
    colorDepth: 24,
    deviceMemory: [2, 4, 8, 16][Math.floor(Math.random() * 4)],
    hardwareConcurrency: [2, 4, 6, 8, 12, 16][Math.floor(Math.random() * 6)],
    platform: osFamily === "Windows" ? "Win32" : 
              osFamily === "macOS" ? "MacIntel" : 
              osFamily === "Linux" ? "Linux x86_64" : 
              osFamily === "Android" ? "Android" : "iPhone",
    language: ["en-US", "en-GB", "fr-FR", "de-DE", "es-ES", "it-IT", "ja-JP", "ko-KR", "pt-BR", "ru-RU", "zh-CN"]
      [Math.floor(Math.random() * 11)],
    doNotTrack: Math.random() > 0.7 ? "1" : null,
    cookieEnabled: Math.random() > 0.05,
    timezone: Math.floor(Math.random() * 25) - 12, // -12 to +12
    timezoneString: "",
    plugins: generateRandomPlugins(browserName, osFamily),
    touchSupported: osFamily === "Android" || osFamily === "iOS" || Math.random() < 0.1,
    maxTouchPoints: osFamily === "Android" || osFamily === "iOS" ? [1, 2, 5][Math.floor(Math.random() * 3)] : 0,
    webdriver: false,
    webgl: {
      vendor: osFamily === "macOS" ? "Apple" : "Google Inc. (NVIDIA)",
      renderer: osFamily === "macOS" ? "Apple GPU" : "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)"
    },
    hasTouch: osFamily === "Android" || osFamily === "iOS",
    isMobile: osFamily === "Android" || osFamily === "iOS"
  };
  
  // Set timezone string based on timezone offset
  enhancedFingerprint.timezoneString = getTimezoneString(enhancedFingerprint.timezone);
  
  return enhancedFingerprint;
}

/**
 * Generate random browser plugins based on browser and OS
 * @param {string} browserName - Name of the browser
 * @param {string} osFamily - Name of the OS family
 * @returns {Array} - Array of plugin objects
 */
function generateRandomPlugins(browserName, osFamily) {
  const plugins = [];
  
  // Common plugins
  const commonPlugins = [
    { name: "PDF Viewer", description: "Portable Document Format", filename: "internal-pdf-viewer" },
    { name: "Chrome PDF Viewer", description: "Portable Document Format", filename: "chrome-pdf-viewer" },
    { name: "Chromium PDF Viewer", description: "Portable Document Format", filename: "chromium-pdf-viewer" },
    { name: "Microsoft Edge PDF Viewer", description: "Portable Document Format", filename: "edge-pdf-viewer" },
    { name: "WebKit built-in PDF", description: "Portable Document Format", filename: "webkit-pdf-viewer" },
    { name: "Native Client", description: "Native Client", filename: "internal-nacl-plugin" }
  ];
  
  // Browser-specific plugins
  if (browserName === "Chrome" || browserName === "Edge") {
    // Chrome plugins
    plugins.push(commonPlugins[0], commonPlugins[1], commonPlugins[5]);
    if (Math.random() > 0.5) {
      plugins.push({ 
        name: "Chrome Remote Desktop Viewer", 
        description: "This plugin allows you to securely access other computers or allow another user to access your computer securely.", 
        filename: "internal-remoting-viewer" 
      });
    }
  } else if (browserName === "Firefox") {
    // Firefox plugins
    plugins.push(commonPlugins[0]);
    if (Math.random() > 0.7 && osFamily !== "iOS" && osFamily !== "Android") {
      plugins.push({ 
        name: "Widevine Content Decryption Module", 
        description: "Enables Widevine licenses for playback of HTML audio/video content.", 
        filename: "widevine-cdm" 
      });
    }
  } else if (browserName === "Safari") {
    // Safari plugins (typically very few)
    plugins.push(commonPlugins[4]);
  }
  
  // Add random popular extensions with low probability
  if (Math.random() > 0.85 && browserName !== "Safari") {
    const popularExtensions = [
      { name: "AdBlock", description: "Blocks ads on websites", filename: "adblock.dll" },
      { name: "uBlock Origin", description: "An efficient blocker", filename: "ublock.dll" },
      { name: "Grammarly", description: "Enhance your writing", filename: "grammarly.dll" },
      { name: "Honey", description: "Automatic coupon finder", filename: "honey.dll" },
      { name: "LastPass", description: "Password manager", filename: "lastpass.dll" }
    ];
    
    plugins.push(popularExtensions[Math.floor(Math.random() * popularExtensions.length)]);
  }
  
  return plugins;
}

/**
 * Apply comprehensive fingerprinting to a page
 * @param {Object} page - Puppeteer page object
 * @param {Object} fingerprint - Fingerprint configuration
 */
async function applyAdvancedFingerprinting(page, fingerprint) {
  // Set extra HTTP headers for language and accept headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': fingerprint.language,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Sec-Fetch-Dest': 'document',
    // Removed 'Cache-Control' header as it causes CORS issues
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': `"${fingerprint.browserName}";v="${fingerprint.browserVersion}", "Not_A Brand";v="99"`,
    'sec-ch-ua-mobile': fingerprint.isMobile ? '?1' : '?0',
    'sec-ch-ua-platform': `"${fingerprint.osFamily}"`
  });
  
  // Emulate timezone
  await page.emulateTimezone(fingerprint.timezoneString);
  
  // Advanced fingerprint evasion using evaluateOnNewDocument
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
    
    // Override screen properties
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
            return fp.screenResolution.height - 40; // Account for OS taskbars
          case 'colorDepth':
            return fp.colorDepth;
          case 'pixelDepth':
            return fp.colorDepth;
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
    
    // Override plugins - create a more realistic plugins array
    if (fp.browserName !== 'Safari') {
      const pluginArray = fp.plugins.map(plugin => {
        return {
          name: plugin.name,
          description: plugin.description,
          filename: plugin.filename,
          length: 1,
          item: () => null,
          namedItem: () => null
        };
      });
      
      // Add methods to the array
      pluginArray.refresh = () => {};
      pluginArray.item = (index) => pluginArray[index] || null;
      pluginArray.namedItem = (name) => {
        for (const plugin of pluginArray) {
          if (plugin.name === name) return plugin;
        }
        return null;
      };
      
      Object.defineProperty(navigator, 'plugins', {
        get: () => pluginArray,
        enumerable: true,
        configurable: false
      });
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
    
    // Mock Chrome-specific features if browser is Chrome or Edge
    if (fp.browserName === 'Chrome' || fp.browserName === 'Edge') {
      window.chrome = {
        app: {
          InstallState: {
            DISABLED: 'disabled',
            INSTALLED: 'installed',
            NOT_INSTALLED: 'not_installed'
          },
          RunningState: {
            CANNOT_RUN: 'cannot_run',
            READY_TO_RUN: 'ready_to_run',
            RUNNING: 'running'
          },
          getDetails: () => ({}),
          getIsInstalled: () => false,
          installState: () => 'not_installed',
          isInstalled: false,
          runningState: () => 'cannot_run'
        },
        runtime: {
          OnInstalledReason: {
            CHROME_UPDATE: 'chrome_update',
            INSTALL: 'install',
            SHARED_MODULE_UPDATE: 'shared_module_update',
            UPDATE: 'update'
          },
          OnRestartRequiredReason: {
            APP_UPDATE: 'app_update',
            OS_UPDATE: 'os_update',
            PERIODIC: 'periodic'
          },
          PlatformArch: {
            ARM: 'arm',
            ARM64: 'arm64',
            MIPS: 'mips',
            MIPS64: 'mips64',
            X86_32: 'x86-32',
            X86_64: 'x86-64'
          },
          PlatformNaclArch: {
            ARM: 'arm',
            MIPS: 'mips',
            MIPS64: 'mips64',
            X86_32: 'x86-32',
            X86_64: 'x86-64'
          },
          PlatformOs: {
            ANDROID: 'android',
            CROS: 'cros',
            LINUX: 'linux',
            MAC: 'mac',
            OPENBSD: 'openbsd',
            WIN: 'win'
          },
          RequestUpdateCheckStatus: {
            NO_UPDATE: 'no_update',
            THROTTLED: 'throttled',
            UPDATE_AVAILABLE: 'update_available'
          }
        }
      };
    }
    
    // Override WebGL to return consistent values
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
    
    // Create consistent canvas fingerprint
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
            // Skip areas that are likely text (detect by checking for anti-aliasing patterns)
            const isLikelyText = data[i+3] > 0 && data[i+3] < 255;
            if (!isLikelyText) {
              data[i] = data[i] + Math.floor(Math.random() * 3) - 1;     // Red
              data[i+1] = data[i+1] + Math.floor(Math.random() * 3) - 1; // Green
              data[i+2] = data[i+2] + Math.floor(Math.random() * 3) - 1; // Blue
            }
          }
          ctx.putImageData(imageData, 0, 0);
        }
      }
      return originalToDataURL.call(this, type, quality);
    };
    
    // Override audio context for audio fingerprinting prevention
    if (window.AudioContext || window.webkitAudioContext) {
      const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
      const OriginalOscillator = window.OscillatorNode;
      const OriginalAnalyser = window.AnalyserNode;
      const OriginalGain = window.GainNode;
      
      // Override createOscillator
      if (OriginalOscillator && OriginalOscillator.prototype) {
        const originalCreateOscillator = OriginalAudioContext.prototype.createOscillator;
        OriginalAudioContext.prototype.createOscillator = function() {
          const oscillator = originalCreateOscillator.call(this);
          oscillator.start = function(when = 0) {
            // Add random tiny delay to frustrate timing attacks
            const randomDelay = Math.random() * 0.01;
            this._start(when + randomDelay);
          };
          Object.defineProperty(oscillator, '_start', { value: oscillator.start });
          return oscillator;
        };
      }
      
      // Override getFloatFrequencyData to add noise
      if (OriginalAnalyser && OriginalAnalyser.prototype) {
        const originalGetFloatFrequencyData = OriginalAnalyser.prototype.getFloatFrequencyData;
        OriginalAnalyser.prototype.getFloatFrequencyData = function(array) {
          originalGetFloatFrequencyData.call(this, array);
          // Add subtle noise to the frequency data
          for (let i = 0; i < array.length; i++) {
            array[i] += Math.random() * 0.1 - 0.05;
          }
          return array;
        };
      }
    }
    
    // Override performance API to prevent timing attacks
    if (window.performance && window.performance.now) {
      const originalNow = window.performance.now;
      window.performance.now = function() {
        // Add small random noise to prevent precise timing analysis
        const noise = Math.random() * 0.1;
        return originalNow.call(this) + noise;
      };
    }
    
    // Override battery API to provide consistent values
    if (navigator.getBattery) {
      navigator.getBattery = function() {
        return Promise.resolve({
          charging: Math.random() > 0.3,
          chargingTime: Math.random() > 0.5 ? Infinity : Math.floor(Math.random() * 7200),
          dischargingTime: Math.random() > 0.5 ? Infinity : Math.floor(Math.random() * 14400),
          level: 0.25 + Math.random() * 0.75,
          addEventListener: function() {},
          removeEventListener: function() {}
        });
      };
    }
    
    // Prevent iframe detection
    if (window.parent !== window) {
      window.parent = window;
    }
    
    // Prevent webdriver detection
    if ('webdriver' in navigator) {
      delete Object.getPrototypeOf(navigator).webdriver;
    }
    
    // Mask Automation-related features
    // Override permissions API
    if (navigator.permissions) {
      const originalQuery = navigator.permissions.query;
      navigator.permissions.query = function(parameters) {
        if (parameters.name === 'notifications') {
          return Promise.resolve({
            state: Notification.permission,
            addEventListener: function() {},
            removeEventListener: function() {},
            dispatchEvent: function() { return true; }
          });
        }
        return originalQuery.apply(this, arguments);
      };
    }
    
    // Override language detection
    Object.defineProperty(navigator, 'language', { 
      get: () => fp.language 
    });
    
    Object.defineProperty(navigator, 'languages', { 
      get: () => [fp.language, fp.language.split('-')[0]] 
    });
    
    // Override connection API
    if (navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: function() {
          return {
            effectiveType: ['4g', '3g'][Math.floor(Math.random() * 2)],
            rtt: Math.floor(Math.random() * 100) + 50,
            downlink: Math.floor(Math.random() * 15) + 5,
            saveData: Math.random() > 0.9
          };
        }
      });
    }
    
    // Override media devices
    if (navigator.mediaDevices) {
      const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
      navigator.mediaDevices.enumerateDevices = function() {
        return originalEnumerateDevices.apply(this, arguments)
          .then(devices => {
            // Filter out detailed device information
            return devices.map(device => {
              const templateDevice = {
                deviceId: device.deviceId,
                kind: device.kind,
                label: '',
                groupId: ''
              };
              
              // If permission is granted, use real labels but simplify them
              if (device.label) {
                if (device.kind === 'audioinput') {
                  templateDevice.label = 'Default Microphone';
                } else if (device.kind === 'audiooutput') {
                  templateDevice.label = 'Default Speaker';
                } else if (device.kind === 'videoinput') {
                  templateDevice.label = 'Default Camera';
                }
              }
              
              return templateDevice;
            });
          });
      };
    }
  }, fingerprint);
  
  // Add additional page configuration
  await page.evaluateOnNewDocument(() => {
    // Function to override native methods with custom ones that preserve functionality
    function overrideNativeMethods() {
      // Override toString methods to prevent detection
      const nativeToString = Function.prototype.toString;
      Function.prototype.toString = function() {
        // Return native code string for built-in functions
        if (this === Function.prototype.toString) {
          return 'function toString() { [native code] }';
        }
        if (this === navigator.getBattery) {
          return 'function getBattery() { [native code] }';
        }
        if (/^class /.test(nativeToString.call(this))) {
          return nativeToString.call(this);
        }
        
        // Otherwise, return the original function string
        return nativeToString.call(this);
      };
      
      // Override JavaScript getters
      const objectDefinePropertyOriginal = Object.defineProperty;
      Object.defineProperty = function(obj, prop, descriptor) {
        // If descriptor has get or set, make them look like native code
        if (descriptor && (descriptor.get || descriptor.set)) {
          if (descriptor.get) {
            const originalGet = descriptor.get;
            descriptor.get = function() {
              return originalGet.call(this);
            };
            Object.defineProperty(descriptor.get, 'toString', {
              value: function() {
                return 'function get ' + prop + '() { [native code] }';
              }
            });
          }
          if (descriptor.set) {
            const originalSet = descriptor.set;
            descriptor.set = function(val) {
              return originalSet.call(this, val);
            };
            Object.defineProperty(descriptor.set, 'toString', {
              value: function() {
                return 'function set ' + prop + '() { [native code] }';
              }
            });
          }
        }
        return objectDefinePropertyOriginal.call(this, obj, prop, descriptor);
      };
    }
    
    // Function to clean the stack trace to avoid detection
    function cleanStackTraces() {
      const originalPrepareStackTrace = Error.prepareStackTrace;
      Error.prepareStackTrace = function(error, structuredStackTrace) {
        return structuredStackTrace.map(frame => {
          // Hide Puppeteer-related filenames
          if (frame.getFileName() && frame.getFileName().includes('puppeteer')) {
            const cleanedFrame = Object.create(frame);
            Object.defineProperty(cleanedFrame, 'getFileName', {
              value: function() {
                return 'https://example.com/script.js';
              }
            });
            return cleanedFrame;
          }
          return frame;
        });
      };
    }
    
    // Execute all modifications
    overrideNativeMethods();
    // Using cleanStackTraces() can be buggy, uncomment if needed
    // cleanStackTraces();
  });
}

/**
 * Configure browser to intercept and handle requests
 * @param {Object} page - Puppeteer page object
 */
async function setupRequestInterception(page) {
  await page.setRequestInterception(true);
  
  page.on('request', (request) => {
    const url = request.url().toLowerCase();
    const resourceType = request.resourceType();
    
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
        url.includes('.ts')
      )) {
      request.continue();
      return;
    }
    
    // Allow through connections to Kick websockets and Datadog - needed for proper stream functionality
    if (url.includes('websocket') || 
        url.includes('wss://') || 
        url.includes('ws://') || 
        url.includes('media.kick.com') ||
        url.includes('video.kick.com') ||
        url.includes('datadoghq.com') ||
        url.includes('akamaihd.net') ||
        url.includes('cloudfront.net')) {
      request.continue();
      return;
    }
    
    // Critical resource types for streaming should be allowed
    if (resourceType === 'websocket' || 
        resourceType === 'media' || 
        resourceType === 'xhr' || 
        resourceType === 'fetch' ||
        (resourceType === 'script' && url.includes('kick.com'))) {
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
      url.includes('fingerprintjs') ||
      url.includes('clarity.ms') ||
      url.includes('recaptcha') ||
      url.includes('datadome') ||
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
}

/**
 * Handle common page barriers (cookie consent, ad overlays, etc)
 * @param {Object} page - Puppeteer page object
 */
async function handlePageBarriers(page) {
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
    
    // Try to ensure video autoplay
    try {
      // First try direct play on video element
      await page.evaluate(() => {
        const videos = document.querySelectorAll('video, #video-player');
        for (const video of videos) {
          if (video.paused) {
            video.play().catch(() => {});
          }
          
          // Make sure it's not muted
          if (video.muted) {
            video.muted = false;
          }
          
          // Set volume to 50%
          video.volume = 0.5;
        }
      });
      
      // Then try clicking play buttons
      const playButtonSelectors = [
        'button[class*="play"]',
        'button[aria-label="Play"]',
        'div[class*="play-button"]',
        '.ytp-play-button',
        '.vjs-play-control'
      ];
      
      for (const selector of playButtonSelectors) {
        const playButtons = await page.$$(selector);
        if (playButtons.length > 0) {
          for (const button of playButtons) {
            try {
              await button.click();
              await page.waitForTimeout(1000);
              break;
            } catch (e) {
              // Try next button if one fails
              continue;
            }
          }
        }
      }
    } catch (error) {
      logger.debug(`Failed to auto-play video: ${error.message}`);
    }
  } catch (error) {
    logger.warn(`Error handling page barriers: ${error.message}`);
    // Don't throw so the process can continue
  }
}

/**
 * Check if a stream is live on Kick.com
 * @param {Object} page - Puppeteer page object
 * @returns {boolean} - Whether the stream is live
 */
async function checkStreamStatus(page) {
  try {
    // This implementation is specialized for Kick.com
    
    // Check for the Kick.com video player
    const hasVideo = await page.evaluate(() => {
      // Check for video element with ID 'video-player' (Kick.com specific)
      const kickPlayer = document.querySelector('#video-player');
      if (kickPlayer && !kickPlayer.paused && kickPlayer.readyState > 2) {
        return true;
      }
      
      // Backup checks for other video players
      const videos = document.querySelectorAll('video');
      for (const video of videos) {
        if (!video.paused && video.readyState > 2) {
          return true;
        }
      }
      
      return !!document.querySelector('iframe[src*="player"]') ||
             !!document.querySelector('.stream-player') ||
             !!document.querySelector('.video-js');
    });
    
    // Check if there's a "Live" indicator specific to Kick.com
    const hasLiveIndicator = await page.evaluate(() => {
      // Look for Kick.com specific live indicators
      const liveElements = document.querySelectorAll('.live-indicator, .stream-status--live, .status-live');
      if (liveElements.length > 0) {
        return true;
      }
      
      // Fallback to generic live indicators
      const allElements = Array.from(document.querySelectorAll('*')).filter(el => {
        const text = el.innerText && el.innerText.trim().toUpperCase();
        const classes = el.className && typeof el.className === 'string' ? el.className : '';
        const dataAttrs = el.getAttribute('data-status') || el.getAttribute('data-state') || '';
        
        return (text === 'LIVE') || 
               classes.includes('live') || 
               dataAttrs === 'live';
      });
      
      return allElements.length > 0;
    });
    
    // Check for Kick.com specific offline indicators
    const hasOfflineMessage = await page.evaluate(() => {
      // Look for specific offline indicators for Kick.com
      const offlineElements = document.querySelectorAll('.offline-indicator, .stream-status--offline, .status-offline');
      if (offlineElements.length > 0) {
        return true;
      }
      
      // Fallback to checking page text
      const text = document.body.innerText.toLowerCase();
      
      // Check for common offline indicators
      const offlineIndicators = [
        'offline',
        'not live', 
        'stream ended',
        'no longer live',
        'was live',
        'currently offline',
        'this channel is not live'
      ];
      
      return offlineIndicators.some(indicator => text.includes(indicator));
    });
    
    // Debug logging
    logger.debug(`Kick stream status check: hasVideo=${hasVideo}, hasLiveIndicator=${hasLiveIndicator}, hasOfflineMessage=${hasOfflineMessage}`);
    
    // For Kick streams, prioritize the live indicator if video is detected
    return hasVideo && (hasLiveIndicator || !hasOfflineMessage);
  } catch (error) {
    logger.error(`Failed to check Kick stream status: ${error.message}`);
    return false; // Assume not live on error
  }
}

/**
 * Extract stream information for Kick.com (title, streamer, viewers)
 * @param {Object} page - Puppeteer page object
 * @returns {Object} - Stream metadata
 */
async function extractStreamMetadata(page) {
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
        
        // Fallback to generic title selectors
        if (!metadata.title) {
          const genericTitleSelectors = [
            'h1[class*="title"]',
            'div[class*="title"]',
            'span[title]',
            'title'
          ];
          
          for (const selector of genericTitleSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              metadata.title = element.innerText || element.textContent || element.getAttribute('title') || '';
              if (metadata.title) {
                metadata.title = metadata.title.trim();
                break;
              }
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
        
        // Fallback to generic streamer selectors
        if (!metadata.streamerName) {
          const genericStreamerSelectors = [
            'a[href*="/channel/"]',
            'h1[class*="channel"]',
            'div[class*="username"]',
            'div[class*="channel"] h2'
          ];
          
          for (const selector of genericStreamerSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              metadata.streamerName = element.innerText || element.textContent || '';
              if (metadata.streamerName) {
                metadata.streamerName = metadata.streamerName.trim();
                break;
              }
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
        
        // Fallback to generic game selectors
        if (!metadata.game) {
          const genericGameSelectors = [
            'a[href*="/game/"]',
            'a[href*="/category/"]',
            '.stream-game-name',
            '.stream__game'
          ];
          
          for (const selector of genericGameSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              metadata.game = element.innerText || element.textContent || '';
              if (metadata.game) {
                metadata.game = metadata.game.trim();
                break;
              }
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
        
        // If no specific selector worked, try a broader approach
        if (!metadata.viewers) {
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            if (!el || !el.innerText) continue;
            const text = el.innerText.trim();
            const match = text.match(/(\d[\d,\.]+)\s*(viewer|watching|view|spectator)/i);
            if (match) {
              metadata.viewers = parseInt(match[1].replace(/[,\.]/g, ''));
              break;
            }
          }
        }
        
        // Check if the stream is actually live
        const liveIndicators = document.querySelectorAll('.live, .isLive, .live-indicator, .stream-status--live, [data-a-target="live-indicator"]');
        metadata.isLive = liveIndicators.length > 0;
        
        // Duration of stream if available
        const durationSelectors = [
          '.stream-duration',
          '.stream-uptime',
          '.live-time',
          '.uptime-indicator',
          '.stream-info-card__time'
        ];
        
        for (const selector of durationSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            metadata.duration = element.innerText || element.textContent || '';
            if (metadata.duration) {
              metadata.duration = metadata.duration.trim();
              break;
            }
          }
        }
        
        return metadata;
      } catch (error) {
        console.error('Error extracting metadata:', error);
        return {};
      }
    });
  } catch (error) {
    logger.error(`Failed to extract stream metadata: ${error.message}`);
    return {};
  }
}

/**
 * Extract stream playback status (playing, buffering, etc)
 * @param {Object} page - Puppeteer page object
 * @returns {Object} - Playback status information
 */
async function extractPlaybackStatus(page) {
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
        } else {
          // Fallback to generic video element
          const video = document.querySelector('video');
          if (video) {
            status.isPlaying = !video.paused && !video.ended && video.currentTime > 0 && video.readyState > 2;
            status.isPaused = video.paused;
            status.isBuffering = video.readyState < 3;
            status.isMuted = video.muted;
            status.volume = Math.round(video.volume * 100);
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
        
        return status;
      } catch (error) {
        console.error('Error extracting playback status:', error);
        return { ...status, error: error.message };
      }
    });
  } catch (error) {
    logger.error(`Failed to extract playback status: ${error.message}`);
    return { isPlaying: false, error: error.message };
  }
}

/**
 * Extract chat messages from the Kick.com stream page
 * @param {Object} page - Puppeteer page object
 * @returns {Array} - Chat messages
 */
async function extractChatMessages(page) {
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
        
        // Fallback to generic chat containers
        if (!chatContainer) {
          const genericContainers = [
            '.chat-window__messages',
            '.chat-scrollable-area__message-container',
            '.stream-chat',
            '.vjs-comment-list',
            '#chat-room-header-label'
          ];
          
          for (const selector of genericContainers) {
            chatContainer = document.querySelector(selector);
            if (chatContainer) break;
          }
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
        
        // Fallback to generic message selectors
        if (messageElements.length === 0) {
          const genericMessageSelectors = [
            '.chat-line',
            '.chat-line__message',
            '.message'
          ];
          
          for (const selector of genericMessageSelectors) {
            messageElements = chatContainer.querySelectorAll(selector);
            if (messageElements.length > 0) break;
          }
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
          } else {
            // Fallback to generic username selectors
            const genericUsernameEl = messageEl.querySelector('.chat-author__display-name, .chat-line__username, .username');
            if (genericUsernameEl) {
              username = genericUsernameEl.innerText || genericUsernameEl.textContent || '';
            }
          }
          
          // Extract message text - Kick.com specific
          let messageText = '';
          const textEl = messageEl.querySelector('.chat-message-content, .chat-entry__message, .message-content');
          if (textEl) {
            messageText = textEl.innerText || textEl.textContent || '';
          } else {
            // Fallback to generic text selectors
            const genericTextEl = messageEl.querySelector('.chat-line__message-body, .message-body, .chat-message__message, .text-fragment');
            if (genericTextEl) {
              messageText = genericTextEl.innerText || genericTextEl.textContent || '';
            } else {
              // If no specific text element found, try to extract text after username
              const fullText = messageEl.innerText || messageEl.textContent || '';
              if (username && fullText.includes(username)) {
                messageText = fullText.substring(fullText.indexOf(username) + username.length).trim();
                // Remove colons and other common separators
                messageText = messageText.replace(/^[:\->\s]+/, '').trim();
              } else {
                messageText = fullText;
              }
            }
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
    logger.error(`Failed to extract chat messages: ${error.message}`);
    return [];
  }
}

/**
 * Start a viewer
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
  
  logger.info(`Starting viewer ${viewer.name} for stream ${viewer.streamUrl}`);
  
  // Generate an advanced fingerprint for this viewer
  const browserFingerprint = generateAdvancedFingerprint();
  
  // Update viewer with the fingerprint
  viewer.browserFingerprint = browserFingerprint;
  viewer.status = 'starting';
  await saveViewerWithLock(viewer);
  
  try {
    // Enhanced launch options
    const launchOptions = {
      headless: config.puppeteer.headless,
      executablePath: '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        `--window-size=${browserFingerprint.screenResolution.width},${browserFingerprint.screenResolution.height}`,
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
        '--disable-default-apps',
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
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled',
        '--ignore-certificate-errors',
        `--user-agent=${browserFingerprint.userAgent}`,
        '--autoplay-policy=no-user-gesture-required', // Important for auto-playing video
        '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies' // Help with autoplay
      ],
      ignoreHTTPSErrors: true,
      defaultViewport: {
        width: browserFingerprint.screenResolution.width,
        height: browserFingerprint.screenResolution.height,
        deviceScaleFactor: 1,
        hasTouch: browserFingerprint.hasTouch,
        isLandscape: true,
        isMobile: browserFingerprint.isMobile
      },
      timeout: 60000 // 60 second timeout for browser launch
    };
    
    // Launch a new browser instance
    const browser = await puppeteer.launch(launchOptions);
    
    // Create a new page
    const page = await browser.newPage();
    
    // Apply advanced fingerprinting to make the browser appear more human-like
    await applyAdvancedFingerprinting(page, browserFingerprint);
    
    // Set up request interception to allow essential Kick.com resources and block tracking
    await setupRequestInterception(page);
    
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
    await setupPageEventListeners(page, viewer);
    
    // Store the browser and page instances
    browserInstances.set(viewerId.toString(), { browser, page });
    
    // Add some random delay to appear more human-like
    const randomDelay = Math.floor(Math.random() * 1000) + 500;
    await page.waitForTimeout(randomDelay);
    
    // Navigate to the stream URL with enhanced timeouts and options
    await page.goto(viewer.streamUrl, { 
      waitUntil: 'domcontentloaded', // Initial load with domcontentloaded
      timeout: 60000 // 60 seconds timeout
    });
    
    // Wait for necessary resources to load
    await page.waitForTimeout(5000);
    
    // Now wait for network to be idle - this helps with dynamic content loading
    try {
      await page.waitForNavigation({ 
        waitUntil: 'networkidle2', 
        timeout: 15000 
      }).catch(() => {}); // We'll continue even if this times out
    } catch (error) {
      logger.debug(`Network idle timeout for ${viewer.name}: ${error.message}`);
    }
    
    // Handle potential barriers (cookie consent, etc.)
    await handlePageBarriers(page);
    
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
      // Try one last approach - sometimes the video player is in an iframe
      const frames = page.frames();
      for (const frame of frames) {
        try {
          for (const selector of kickVideoSelectors) {
            const element = await frame.$(selector);
            if (element) {
              logger.info(`Video player found in iframe with selector "${selector}" for viewer ${viewer.name}`);
              videoPlayerFound = true;
              break;
            }
          }
          if (videoPlayerFound) break;
        } catch (frameError) {
          logger.debug(`Error checking iframe for video: ${frameError.message}`);
        }
      }
    }
    
    if (!videoPlayerFound) {
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
    
    // Try to play the stream more aggressively - Kick.com specific approach
    await page.evaluate(() => {
      // Try direct approach for Kick.com video player
      try {
        const kickVideo = document.querySelector('#video-player');
        if (kickVideo) {
          kickVideo.play().catch(e => console.error('Error playing Kick video:', e));
          kickVideo.muted = false;
          kickVideo.volume = 0.5;
          kickVideo.controls = true;
          kickVideo.autoplay = true;
        } else {
          // Fallback to any video element
          const videos = document.querySelectorAll('video');
          for (const video of videos) {
            video.play().catch(e => console.error('Error playing video:', e));
            video.muted = false;
            video.volume = 0.5;
            video.controls = true;
            video.autoplay = true;
          }
        }
      } catch (e) {
        console.error('Error while attempting to play video:', e);
      }
      
      // Try to click any play buttons - Kick.com specific
      try {
        const kickPlayButtons = [
          document.querySelector('.play-button'),
          document.querySelector('.vjs-big-play-button'),
          document.querySelector('.player-control-playpause'),
          ...Array.from(document.querySelectorAll('button')).filter(b => 
            (b.innerText || '').toLowerCase().includes('play') || 
            (b.title || '').toLowerCase().includes('play') ||
            (b.ariaLabel || '').toLowerCase().includes('play')
          )
        ].filter(Boolean);
        
        for (const button of kickPlayButtons) {
          try {
            button.click();
          } catch (e) {
            // Ignore click errors
          }
        }
      } catch (e) {
        console.error('Error while clicking play buttons:', e);
      }
    });
    
    // Check if the stream is live
    const isLive = await checkStreamStatus(page);
    if (!isLive) {
      logger.warn(`Stream ${viewer.streamUrl} appears to be offline for viewer ${viewer.name}`);
    } else {
      logger.info(`Stream ${viewer.streamUrl} is live for viewer ${viewer.name}`);
    }
    
    // Extract stream information
    const streamMetadata = await extractStreamMetadata(page);
    viewer.streamMetadata = streamMetadata;
    
    // Start the update interval for this viewer
    startUpdateInterval(viewerId);
    
    // Update viewer status
    viewer.status = 'running';
    viewer.error = null;
    viewer.lastActivityAt = new Date();
    await saveViewerWithLock(viewer);
    
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
 * Navigate to a stream
 * @param {string} viewerId - ID of the viewer
 * @param {string} streamUrl - URL of the stream to navigate to
 * @returns {Promise<boolean>} - Success status
 */
exports.navigateToStream = async (viewerId, streamUrl) => {
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
  
  logger.info(`Navigating viewer ${viewer.name} to stream ${streamUrl}`);
  
  try {
    const { page } = browserInstances.get(viewerId.toString());
    
    // Add some random delay to appear more human-like
    const randomDelay = Math.floor(Math.random() * 1000) + 500;
    await page.waitForTimeout(randomDelay);
    
    // Navigate to the new stream URL
    await page.goto(streamUrl, { 
      waitUntil: 'domcontentloaded', // Initial load with domcontentloaded
      timeout: 60000 // 60 seconds timeout
    });
    
    // Wait for necessary resources to load
    await page.waitForTimeout(5000);
    
    // Now wait for network to be idle - this helps with dynamic content loading
    try {
      await page.waitForNavigation({ 
        waitUntil: 'networkidle2', 
        timeout: 15000 
      }).catch(() => {}); // We'll continue even if this times out
    } catch (error) {
      logger.debug(`Network idle timeout for ${viewer.name}: ${error.message}`);
    }
    
    // Handle potential barriers (cookie consent, etc.)
    await handlePageBarriers(page);
    
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
      // Try one last approach - sometimes the video player is in an iframe
      const frames = page.frames();
      for (const frame of frames) {
        try {
          for (const selector of kickVideoSelectors) {
            const element = await frame.$(selector);
            if (element) {
              logger.info(`Video player found in iframe with selector "${selector}" for viewer ${viewer.name}`);
              videoPlayerFound = true;
              break;
            }
          }
          if (videoPlayerFound) break;
        } catch (frameError) {
          logger.debug(`Error checking iframe for video: ${frameError.message}`);
        }
      }
    }
    
    if (!videoPlayerFound) {
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
    
    // Try to play the stream more aggressively - Kick.com specific approach
    await page.evaluate(() => {
      // Try direct approach for Kick.com video player
      try {
        const kickVideo = document.querySelector('#video-player');
        if (kickVideo) {
          kickVideo.play().catch(e => console.error('Error playing Kick video:', e));
          kickVideo.muted = false;
          kickVideo.volume = 0.5;
          kickVideo.controls = true;
          kickVideo.autoplay = true;
        } else {
          // Fallback to any video element
          const videos = document.querySelectorAll('video');
          for (const video of videos) {
            video.play().catch(e => console.error('Error playing video:', e));
            video.muted = false;
            video.volume = 0.5;
            video.controls = true;
            video.autoplay = true;
          }
        }
      } catch (e) {
        console.error('Error while attempting to play video:', e);
      }
      
      // Try to click any play buttons - Kick.com specific
      try {
        const kickPlayButtons = [
          document.querySelector('.play-button'),
          document.querySelector('.vjs-big-play-button'),
          document.querySelector('.player-control-playpause'),
          ...Array.from(document.querySelectorAll('button')).filter(b => 
            (b.innerText || '').toLowerCase().includes('play') || 
            (b.title || '').toLowerCase().includes('play') ||
            (b.ariaLabel || '').toLowerCase().includes('play')
          )
        ].filter(Boolean);
        
        for (const button of kickPlayButtons) {
          try {
            button.click();
          } catch (e) {
            // Ignore click errors
          }
        }
      } catch (e) {
        console.error('Error while clicking play buttons:', e);
      }
    });
    
    // Check if the stream is live
    const isLive = await checkStreamStatus(page);
    if (!isLive) {
      logger.warn(`Stream ${streamUrl} appears to be offline for viewer ${viewer.name}`);
    } else {
      logger.info(`Stream ${streamUrl} is live for viewer ${viewer.name}`);
    }
    
    // Extract stream information
    const streamMetadata = await extractStreamMetadata(page);
    viewer.streamMetadata = streamMetadata;
    
    // Update viewer
    viewer.streamUrl = streamUrl;
    viewer.streamer = streamMetadata.streamerName || streamUrl.split('/').pop();
    viewer.lastActivityAt = new Date();
    await saveViewerWithLock(viewer);
    
    // Check if stream exists in database, if not create it
    let stream = await Stream.findOne({ url: streamUrl });
    if (!stream) {
      stream = new Stream({
        url: streamUrl,
        streamer: viewer.streamer,
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
    
    // Remove from previous stream
    await Stream.updateMany(
      { url: { $ne: streamUrl }, activeViewers: viewer._id },
      { $pull: { activeViewers: viewer._id } }
    );
    
    logger.info(`Viewer ${viewer.name} navigated to stream ${streamUrl}`);
    
    // Take a screenshot after navigation
    try {
      await exports.takeScreenshot(viewerId);
    } catch (screenshotError) {
      logger.warn(`Failed to take navigation screenshot: ${screenshotError.message}`);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error navigating viewer ${viewer.name} to ${streamUrl}: ${error.message}`);
    
    // Update viewer error
    viewer.error = error.message;
    await saveViewerWithLock(viewer);
    
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
    
    // Take screenshot
    await page.screenshot({ 
      path: screenshotPath, 
      fullPage: false,
      type: 'png'
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
 * Set up page event listeners
 * @param {Object} page - Puppeteer page object
 * @param {Object} viewer - Viewer model instance
 */
async function setupPageEventListeners(page, viewer) {
  // Log console messages
  page.on('console', async (msg) => {
    const logLevel = msg.type() === 'error' ? 'error' : 
                    msg.type() === 'warning' ? 'warn' : 'debug';
    
    if (logLevel === 'error' || logLevel === 'warn') {
      // Only log errors and warnings to avoid too much noise
      logger[logLevel](`Console ${msg.type()} (${viewer.name}): ${msg.text()}`);
      
      // Add to viewer logs
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
  
  // Log page errors
  page.on('error', async (error) => {
    logger.error(`Page error for viewer ${viewer.name}: ${error.message}`);
    
    // Add to viewer logs
    viewer.logs.push({
      level: 'error',
      message: `Page error: ${error.message}`,
    });
    
    // If too many logs, remove oldest
    if (viewer.logs.length > 100) {
      viewer.logs = viewer.logs.slice(-100);
    }
    
    await saveViewerWithLock(viewer);
  });
  
  // Log navigation and responses
  page.on('response', async (response) => {
    const status = response.status();
    const url = response.url();
    
    // Only log failed responses or important responses for Kick.com
    if ((status >= 400 || url.includes('auth') || url.includes('login') || url.includes('stream') || 
         url.includes('chat') || url.includes('video') || url.includes('player')) &&
        url.includes('kick.com')) {
      logger.debug(`Response ${status} for ${url} (${viewer.name})`);
      
      // For certain critical errors, log them to the viewer logs
      if (status >= 500 || (status >= 400 && url.includes('stream'))) {
        viewer.logs.push({
          level: 'warn',
          message: `Response ${status} for ${url}`,
        });
        
        // If too many logs, remove oldest
        if (viewer.logs.length > 100) {
          viewer.logs = viewer.logs.slice(-100);
        }
        
        await saveViewerWithLock(viewer);
      }
    }
  });
  
  // Handle dialog events (alerts, confirms, prompts)
  page.on('dialog', async (dialog) => {
    logger.info(`Dialog appeared for viewer ${viewer.name}: ${dialog.message()}`);
    
    // Add to viewer logs
    viewer.logs.push({
      level: 'info',
      message: `Dialog: ${dialog.type()} - ${dialog.message()}`,
    });
    
    // If too many logs, remove oldest
    if (viewer.logs.length > 100) {
      viewer.logs = viewer.logs.slice(-100);
    }
    
    await saveViewerWithLock(viewer);
    
    // Dismiss dialog to not block the page
    await dialog.dismiss().catch(() => {});
  });
  
  // Handle frame navigation for detecting redirects
  page.on('framenavigated', async (frame) => {
    if (frame === page.mainFrame()) {
      const url = frame.url();
      if (url.includes('kick.com')) {
        logger.debug(`Main frame navigated to: ${url} (${viewer.name})`);
      }
    }
  });
}

/**
 * Start an update interval for a viewer
 * @param {string} viewerId - ID of the viewer
 */
function startUpdateInterval(viewerId) {
  // Clear any existing interval
  clearUpdateInterval(viewerId);
  
  // Create a new interval
  updateIntervals[viewerId] = setInterval(async () => {
    try {
      await updateViewerStatus(viewerId);
    } catch (error) {
      logger.error(`Error updating viewer ${viewerId}: ${error.message}`);
    }
  }, config.puppeteer.updateInterval || 30000);
}

/**
 * Clear the update interval for a viewer
 * @param {string} viewerId - ID of the viewer
 */
function clearUpdateInterval(viewerId) {
  if (updateIntervals[viewerId]) {
    clearInterval(updateIntervals[viewerId]);
    delete updateIntervals[viewerId];
  }
}

/**
 * Update the status of a viewer
 * @param {string} viewerId - ID of the viewer
 */
async function updateViewerStatus(viewerId) {
  const viewer = await Viewer.findById(viewerId);
  
  if (!viewer || viewer.status !== 'running') {
    clearUpdateInterval(viewerId);
    return;
  }
  
  if (!browserInstances.has(viewerId.toString())) {
    logger.warn(`Browser instance not found for viewer ${viewer.name}`);
    
    // Update viewer status
    viewer.status = 'error';
    viewer.error = 'Browser instance not found';
    await saveViewerWithLock(viewer);
    
    clearUpdateInterval(viewerId);
    return;
  }
  
  try {
    const { page } = browserInstances.get(viewerId.toString());
    
    // Check if page is closed
    if (page.isClosed()) {
      logger.warn(`Page is closed for viewer ${viewer.name}`);
      
      // Update viewer status
      viewer.status = 'error';
      viewer.error = 'Page is closed';
      await saveViewerWithLock(viewer);
      
      clearUpdateInterval(viewerId);
      return;
    }
    
    // Check if the stream is live
    const isLive = await checkStreamStatus(page);
    
    // Extract stream information
    const streamMetadata = await extractStreamMetadata(page);
    
    // Extract playback status
    const playbackStatus = await extractPlaybackStatus(page);
    
    // Extract chat messages
    const chatMessages = await extractChatMessages(page);
    
    // Update viewer with new information
    viewer.streamMetadata = streamMetadata;
    viewer.playbackStatus = playbackStatus;
    viewer.lastActivityAt = new Date();
    
    // Store last few chat messages
    if (chatMessages.length > 0) {
      // Only store the last 50 messages
      viewer.chatMessages = chatMessages.slice(-50);
    }
    
    await saveViewerWithLock(viewer);
    
    // Update the stream document
    if (viewer.streamUrl) {
      const stream = await Stream.findOne({ url: viewer.streamUrl });
      if (stream) {
        stream.title = streamMetadata.title || stream.title;
        stream.game = streamMetadata.game || stream.game;
        stream.viewers = streamMetadata.viewers || stream.viewers;
        stream.isLive = isLive;
        
        // Make sure this viewer is in the active viewers
        if (!stream.activeViewers.includes(viewer._id)) {
          stream.activeViewers.push(viewer._id);
        }
        
        await stream.save();
      }
    }
    
    // Take a screenshot occasionally (every ~5 minutes)
    if (Math.random() < 0.1) {
      try {
        await exports.takeScreenshot(viewerId);
      } catch (screenshotError) {
        logger.warn(`Failed to take periodic screenshot: ${screenshotError.message}`);
      }
    }
    
    // If playback is stuck with an error, try to refresh
    if (playbackStatus.error && !viewer.lastRefreshAt) {
      logger.info(`Playback error detected for ${viewer.name}, refreshing...`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await handlePageBarriers(page);
      viewer.lastRefreshAt = new Date();
      await saveViewerWithLock(viewer);
    } else if (playbackStatus.error && viewer.lastRefreshAt) {
      // If we already tried refreshing and still have errors
      const timeSinceRefresh = new Date() - new Date(viewer.lastRefreshAt);
      if (timeSinceRefresh > 5 * 60 * 1000) {
        // More than 5 minutes since last refresh, try again
        logger.info(`Playback still has errors for ${viewer.name}, refreshing again...`);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await handlePageBarriers(page);
        viewer.lastRefreshAt = new Date();
        await saveViewerWithLock(viewer);
      }
    } else if (!playbackStatus.error && viewer.lastRefreshAt) {
      // Clear the lastRefreshAt if we no longer have errors
      viewer.lastRefreshAt = null;
      await saveViewerWithLock(viewer);
    }
  } catch (error) {
    logger.error(`Error updating viewer ${viewer.name}: ${error.message}`);
    
    // Update viewer error
    viewer.error = error.message;
    await saveViewerWithLock(viewer);
  }
}

// Export functions
module.exports = exports;