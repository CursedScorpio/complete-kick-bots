const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const logger = require('./utils/logger');

// Fix for ReadableStream not defined error
global.ReadableStream = require('web-streams-polyfill').ReadableStream;

// Import routes
const boxRoutes = require('./routes/boxRoutes');
const viewerRoutes = require('./routes/viewerRoutes');
const vpnRoutes = require('./routes/vpnRoutes');
const streamRoutes = require('./routes/streamRoutes');
const systemRoutes = require('./routes/systemRoutes');

// Import utilities
const resourceManager = require('./utils/resourceManager');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all requests
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/api/boxes', boxRoutes);
app.use('/api/viewers', viewerRoutes);
app.use('/api/vpn', vpnRoutes);
app.use('/api/streams', streamRoutes);
app.use('/api/system', systemRoutes);

// Direct health check route for Docker
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`);
  res.status(500).json({ error: err.message || 'Server Error' });
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/kick-viewer-simulator', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  // These settings help prevent the parallel save errors
  maxPoolSize: 100, // Increase connection pool size for parallel operations
  bufferCommands: false, // Disable buffering of commands when driver is disconnected
  autoIndex: false, // Don't auto-build indexes in production
  retryWrites: true // Retry write operations if they fail
})
  .then(() => {
    logger.info('Connected to MongoDB');
    
    // Initialize resource manager
    resourceManager.init({
      debug: process.env.NODE_ENV !== 'production'
    });
    logger.info('Resource Manager initialized');
    
    // Start the server
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    logger.error(`MongoDB connection error: ${err.message}`);
    process.exit(1);
  });

// Add connection error handlers
mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB connection error: ${err.message}`);
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected, attempting to reconnect...');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected successfully');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  // Close server & exit process
  // server.close(() => process.exit(1));
});