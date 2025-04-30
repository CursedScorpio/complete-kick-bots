// utils/fingerprint.js
const { v4: uuidv4 } = require('uuid');

// Common user agents
const userAgents = {
  chrome: {
    'windows': [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.63 Safari/537.36',
    ],
    'macos': [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.63 Safari/537.36',
    ],
    'linux': [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.63 Safari/537.36',
    ],
  },
  firefox: {
    'windows': [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0',
    ],
    'macos': [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:89.0) Gecko/20100101 Firefox/89.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:90.0) Gecko/20100101 Firefox/90.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:91.0) Gecko/20100101 Firefox/91.0',
    ],
    'linux': [
      'Mozilla/5.0 (X11; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0',
      'Mozilla/5.0 (X11; Linux x86_64; rv:90.0) Gecko/20100101 Firefox/90.0',
      'Mozilla/5.0 (X11; Linux x86_64; rv:91.0) Gecko/20100101 Firefox/91.0',
    ],
  },
  safari: {
    'macos': [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
    ],
  },
};

// Common platform values
const platforms = {
  'windows': ['Win32', 'Win64', 'Windows', 'WinCE'],
  'macos': ['MacIntel', 'MacPPC', 'Mac68K', 'Macintosh'],
  'linux': ['Linux x86_64', 'Linux i686', 'Linux armv7l'],
};

// Common screen resolutions
const screenResolutions = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];

// Common color depths
const colorDepths = [24, 30, 32];

// Common device memory values (in GB)
const deviceMemories = [2, 4, 8, 16];

// Common hardware concurrency values
const hardwareConcurrencies = [2, 4, 6, 8, 12, 16];

// Common languages
const languages = {
  'en-US': 'en-US,en;q=0.9',
  'en-GB': 'en-GB,en;q=0.9',
  'es-ES': 'es-ES,es;q=0.9,en;q=0.8',
  'fr-FR': 'fr-FR,fr;q=0.9,en;q=0.8',
  'de-DE': 'de-DE,de;q=0.9,en;q=0.8',
};

// Common timezones
const timezones = {
  'UTC': '(UTC+00:00)',
  'America/New_York': '(UTC-05:00)',
  'Europe/London': '(UTC+00:00)',
  'Europe/Berlin': '(UTC+01:00)',
  'Asia/Tokyo': '(UTC+09:00)',
};

// Generate a random fingerprint
exports.generateRandomFingerprint = (options = {}) => {
  // Default to desktop device
  const device = options.devices ? 
    getRandomItem(options.devices) : 'desktop';
  
  // Select an operating system
  const osOptions = options.operatingSystems || ['windows', 'macos', 'linux'];
  const os = getRandomItem(osOptions);
  
  // Select a browser
  let browserOptions = options.browsers || ['chrome', 'firefox'];
  if (os === 'macos') {
    // Add Safari as an option for macOS
    browserOptions = [...browserOptions, 'safari'];
  } else {
    // Filter out Safari for non-macOS
    browserOptions = browserOptions.filter(browser => browser !== 'safari');
  }
  
  // Default to Chrome if empty
  const browser = browserOptions.length > 0 ? 
    getRandomItem(browserOptions) : 'chrome';
  
  // Generate user agent
  const userAgentList = userAgents[browser]?.[os] || userAgents.chrome.windows;
  const userAgent = getRandomItem(userAgentList);
  
  // Generate platform
  const platformList = platforms[os] || platforms.windows;
  const platform = getRandomItem(platformList);
  
  // Generate language
  const languageOptions = options.locales || ['en-US'];
  const language = languages[getRandomItem(languageOptions)] || languages['en-US'];
  
  // Generate timezone
  const timezoneOptions = options.timezones || ['UTC'];
  const timezone = timezones[getRandomItem(timezoneOptions)] || timezones['UTC'];
  
  // Generate screen resolution
  const screenResolution = getRandomItem(screenResolutions);
  
  // Generate other hardware details
  const colorDepth = getRandomItem(colorDepths);
  const deviceMemory = getRandomItem(deviceMemories);
  const hardwareConcurrency = getRandomItem(hardwareConcurrencies);
  
  return {
    userAgent,
    platform,
    language,
    timezone,
    screenResolution,
    colorDepth,
    deviceMemory,
    hardwareConcurrency,
  };
};

// Helper function to get a random item from an array
function getRandomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}
