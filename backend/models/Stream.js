// models/Stream.js
const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now,
  },
  username: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  emotes: [{
    id: String,
    name: String,
    src: String,
  }],
});

const StreamSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  streamer: {
    type: String,
    required: true,
    trim: true,
  },
  title: {
    type: String,
    default: '',
  },
  game: {
    type: String,
    default: '',
  },
  viewers: {
    type: Number,
    default: 0,
  },
  isLive: {
    type: Boolean,
    default: true,
  },
  startedAt: {
    type: Date,
    default: null,
  },
  chatMessages: [ChatMessageSchema],
  activeViewers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Viewer',
  }],
  lastUpdatedAt: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the lastUpdatedAt field on save
StreamSchema.pre('save', function(next) {
  this.lastUpdatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Stream', StreamSchema);