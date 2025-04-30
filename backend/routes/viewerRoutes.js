// routes/viewerRoutes.js
const express = require('express');
const router = express.Router();
const viewerController = require('../controllers/viewerController');

// Get all viewers
router.get('/', viewerController.getAllViewers);

// Get viewer by ID
router.get('/:id', viewerController.getViewerById);

// Update a viewer
router.put('/:id', viewerController.updateViewer);

// Stop a viewer
router.post('/:id/stop', viewerController.stopViewer);

// Get viewer status
router.get('/:id/status', viewerController.getViewerStatus);

// Get viewer screenshot
router.post('/:id/screenshot', viewerController.getViewerScreenshot);

// Get viewer logs
router.get('/:id/logs', viewerController.getViewerLogs);

// Serve screenshot image
router.get('/screenshots/:filename', viewerController.serveScreenshot);

module.exports = router;
