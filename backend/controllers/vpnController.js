// controllers/vpnController.js
const vpnService = require('../services/vpnService');
const logger = require('../utils/logger');

// Get all available VPN configs
exports.getAllVpnConfigs = async (req, res) => {
  try {
    const vpnConfigs = await vpnService.listVpnConfigs();
    res.status(200).json(vpnConfigs);
  } catch (error) {
    logger.error(`Error listing VPN configs: ${error.message}`);
    res.status(500).json({ message: 'Error retrieving VPN configurations', error: error.message });
  }
};

// Test VPN connection
exports.testVpnConnection = async (req, res) => {
  try {
    const { configName } = req.body;
    
    if (!configName) {
      return res.status(400).json({ message: 'VPN configuration name is required' });
    }
    
    // Check if VPN config exists
    const vpnExists = await vpnService.checkVpnConfigExists(configName);
    if (!vpnExists) {
      return res.status(400).json({ message: 'VPN configuration not found' });
    }
    
    // Test VPN connection
    const testResult = await vpnService.testVpnConnection(configName);
    
    res.status(200).json(testResult);
  } catch (error) {
    logger.error(`Error testing VPN connection: ${error.message}`);
    res.status(500).json({ message: 'Error testing VPN connection', error: error.message });
  }
};

// Upload a new VPN config
exports.uploadVpnConfig = async (req, res) => {
  try {
    // This route would require file upload middleware (e.g., multer)
    if (!req.file) {
      return res.status(400).json({ message: 'No VPN configuration file provided' });
    }
    
    const configName = req.body.name || path.basename(req.file.originalname, '.ovpn');
    
    // Save VPN config
    await vpnService.saveVpnConfig(configName, req.file.buffer);
    
    res.status(201).json({ message: 'VPN configuration uploaded successfully', name: configName });
  } catch (error) {
    logger.error(`Error uploading VPN config: ${error.message}`);
    res.status(500).json({ message: 'Error uploading VPN configuration', error: error.message });
  }
};

// Delete a VPN config
exports.deleteVpnConfig = async (req, res) => {
  try {
    const configName = req.params.name;
    
    // Check if VPN config exists
    const vpnExists = await vpnService.checkVpnConfigExists(configName);
    if (!vpnExists) {
      return res.status(404).json({ message: 'VPN configuration not found' });
    }
    
    // Delete VPN config
    await vpnService.deleteVpnConfig(configName);
    
    res.status(200).json({ message: 'VPN configuration deleted successfully' });
  } catch (error) {
    logger.error(`Error deleting VPN config: ${error.message}`);
    res.status(500).json({ message: 'Error deleting VPN configuration', error: error.message });
  }
};