// config/config.js
const config = {
    // General configuration
    app: {
      name: 'Kick Viewer Simulator',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
    },
    
    // Server configuration
    server: {
      port: process.env.PORT || 5000,
      host: process.env.HOST || 'localhost',
    },
    
    // Database configuration
    db: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/kick-viewer-simulator',
      options: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      },
    },
    
    // Puppeteer configuration
    puppeteer: {
      headless: process.env.PUPPETEER_HEADLESS !== 'false',
      defaultViewport: {
        width: 1920,
        height: 1080,
      },
      defaultNavigationTimeout: 60000,
      defaultTimeout: 30000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    },
    
    // VPN configuration
    vpn: {
      basePath: process.env.VPN_CONFIGS_PATH || '/home/streamv3/vpn',
      connectionTimeout: 120000, // Increased from 30 to 120 seconds
    },
    
    // Viewer configuration
    viewer: {
      instancesPerBox: 10,
      chatParserRatio: 0.1, // 10% of viewers will parse chat (1 out of 10)
      updateInterval: 30000, // Changed from 5000 (5 seconds) to 30000 (30 seconds)
      reconnectInterval: 60000, // 1 minute
      fingerprintOptions: {
        devices: ['desktop'],
        operatingSystems: ['windows', 'macos', 'linux'],
        browsers: ['chrome', 'firefox', 'safari'],
        locales: ['en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE'],
        timezones: ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'],
      },
    },
    
    // Logging configuration
    logging: {
      level: process.env.LOG_LEVEL || 'info',
      format: process.env.LOG_FORMAT || 'combined',
    },
  };
  
  module.exports = config;