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
  viewersPerBox: {
    type: Number,
    default: 10,
    min: 1,
    max: 50,
  },
  ipAddress: {
    type: String,
    default: null,
  },
  location: {
    type: String,
    default: null,
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