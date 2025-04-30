// routes/boxRoutes.js
const express = require('express');
const router = express.Router();
const boxController = require('../controllers/boxController');

// Get all boxes
router.get('/', boxController.getAllBoxes);

// Get box by ID
router.get('/:id', boxController.getBoxById);

// Create a new box
router.post('/', boxController.createBox);

// Update a box
router.put('/:id', boxController.updateBox);

// Delete a box
router.delete('/:id', boxController.deleteBox);

// Start a box
router.post('/:id/start', boxController.startBox);

// Stop a box
router.post('/:id/stop', boxController.stopBox);

// Get box status
router.get('/:id/status', boxController.getBoxStatus);

// Get box resource usage
router.get('/:id/resources', boxController.getBoxResourceUsage);

// Update box resource limits
router.put('/:id/resources/limits', boxController.updateBoxResourceLimits);

// Refresh box IP
router.post('/:id/refresh-ip', boxController.refreshBoxIp);

module.exports = router;
