// models/Viewer.js
const mongoose = require('mongoose');

const ViewerSchema = new mongoose.Schema({
  box: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Box',
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  status: {
    type: String,
    enum: ['idle', 'starting', 'running', 'stopping', 'error'],
    default: 'idle',
  },
  streamUrl: {
    type: String,
    default: null,
  },
  streamer: {
    type: String,
    default: null,
  },
  browserFingerprint: {
    userAgent: String,
    platform: String,
    language: String,
    timezone: String,
    screenResolution: {
      width: Number,
      height: Number,
    },
    colorDepth: Number,
    deviceMemory: Number,
    hardwareConcurrency: Number,
  },
  isParseChatEnabled: {
    type: Boolean,
    default: false,
  },
  lastScreenshotUrl: {
    type: String,
    default: null,
  },
  lastScreenshotTimestamp: {
    type: Date,
    default: null,
  },
  streamMetadata: {
    title: String,
    game: String,
    viewers: Number,
    isLive: Boolean,
    startedAt: Date,
  },
  playbackStatus: {
    isPlaying: {
      type: Boolean,
      default: false,
    },
    resolution: String,
    quality: String,
    buffering: Boolean,
    volume: Number,
  },
  error: {
    type: String,
    default: null,
  },
  lastActivityAt: {
    type: Date,
    default: Date.now,
  },
  logs: [{
    timestamp: {
      type: Date,
      default: Date.now,
    },
    level: {
      type: String,
      enum: ['info', 'warn', 'error'],
      default: 'info',
    },
    message: String,
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt field on save
ViewerSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Viewer', ViewerSchema);