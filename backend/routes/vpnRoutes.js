// routes/vpnRoutes.js
const express = require('express');
const router = express.Router();
const vpnController = require('../controllers/vpnController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Get all available VPN configs
router.get('/configs', vpnController.getAllVpnConfigs);

// Test VPN connection
router.post('/test', vpnController.testVpnConnection);

// Upload a new VPN config
router.post('/configs', upload.single('config'), vpnController.uploadVpnConfig);

// Delete a VPN config
router.delete('/configs/:name', vpnController.deleteVpnConfig);

module.exports = router;