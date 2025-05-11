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

// Get tab screenshot
router.post('/:id/tab-screenshot', viewerController.getTabScreenshot);

// Add a new tab to a viewer
router.post('/:id/add-tab', viewerController.addTab);

// Close a tab
router.post('/:id/close-tab', viewerController.closeTab);

// Get tab statistics
router.get('/:id/tab-stats', viewerController.getTabStats);

// Force lowest quality for a specific tab
router.post('/:id/force-tab-lowest-quality', viewerController.forceTabLowestQuality);

// Get viewer logs
router.get('/:id/logs', viewerController.getViewerLogs);

// Serve screenshot image
router.get('/screenshots/:filename', viewerController.serveScreenshot);

// Add support for nested paths with viewerId/filename format
router.get('/screenshots/:viewerId/:filename', (req, res) => {
  // Combine viewerId and filename and pass to serveScreenshot
  req.params.filename = `${req.params.viewerId}/${req.params.filename}`;
  viewerController.serveScreenshot(req, res);
});

// Force lowest quality (160p)
router.post('/:id/force-lowest-quality', viewerController.forceLowestQuality);

// Force lowest quality (160p) for all viewers
router.post('/force-all-lowest-quality', viewerController.forceAllViewersLowestQuality);

module.exports = router;
