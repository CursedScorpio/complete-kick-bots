// routes/systemRoutes.js
const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');

// Get system health
router.get('/health', systemController.getHealth);

// Get system metrics
router.get('/metrics', systemController.getMetrics);

// Get resource manager metrics
router.get('/resources', systemController.getResourceManagerMetrics);

// Update resource manager configuration
router.put('/resources/config', systemController.updateResourceManagerConfig);

// Trigger a resource check
router.post('/resources/check', systemController.triggerResourceCheck);

// Trigger stopping idle viewers
router.post('/resources/stop-idle', systemController.triggerStopIdleViewers);

module.exports = router; 