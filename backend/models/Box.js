// models/Box.js
const mongoose = require('mongoose');

const BoxSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  vpnConfig: {
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
  ipAddress: {
    type: String,
    default: null,
  },
  location: {
    type: String,
    default: null,
  },
  resources: {
    cpu: {
      type: Number,
      default: 0,
    },
    memory: {
      type: Number,
      default: 0,
    },
    networkRx: {
      type: Number,
      default: 0,
    },
    networkTx: {
      type: Number,
      default: 0,
    },
    diskUsage: {
      type: Number,
      default: 0,
    },
    lastUpdated: {
      type: Date,
      default: null,
    }
  },
  resourceLimits: {
    cpuLimit: {
      type: Number,
      default: 80,   // percentage
    },
    memoryLimit: {
      type: Number,
      default: 1024, // MB
    },
    networkLimit: {
      type: Number,
      default: 20,   // Mbps
    }
  },
  error: {
    type: String,
    default: null,
  },
  startedAt: {
    type: Date,
    default: null,
  },
  viewers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Viewer',
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
BoxSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Box', BoxSchema);