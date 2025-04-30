// services/vpnService.js
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const execPromise = util.promisify(exec);
const Box = require('../models/Box');
const logger = require('../utils/logger');
const config = require('../config/config');
const axios = require('axios');

// Store active VPN processes and their interfaces
const activeVpnProcesses = new Map();
const activeVpnInterfaces = new Map();

// Get the VPN interface for a specific box
exports.getBoxInterface = (boxId) => {
  return activeVpnInterfaces.get(boxId.toString()) || null;
};

// List all available VPN configs
exports.listVpnConfigs = async () => {
  try {
    // Check if directory exists first
    try {
      await fs.access(config.vpn.basePath, fs.constants.R_OK);
    } catch (dirError) {
      logger.error(`VPN config directory does not exist or is not readable: ${config.vpn.basePath}`);
      logger.error(`Error details: ${dirError.message}`);
      
      // Try to create directory if it doesn't exist
      try {
        await fs.mkdir(config.vpn.basePath, { recursive: true });
        logger.info(`Created VPN config directory: ${config.vpn.basePath}`);
      } catch (mkdirError) {
        logger.error(`Failed to create VPN directory: ${mkdirError.message}`);
      }
      
      // Return empty array since there are no configs yet
      return [];
    }
    
    // Read directory contents
    const files = await fs.readdir(config.vpn.basePath);
    const ovpnFiles = files.filter(file => file.endsWith('.ovpn'));
    
    logger.info(`Found ${ovpnFiles.length} VPN configuration files in ${config.vpn.basePath}`);
    
    return ovpnFiles.map(file => ({
      name: path.basename(file, '.ovpn'),
      fullPath: path.join(config.vpn.basePath, file),
    }));
  } catch (error) {
    logger.error(`Error listing VPN configs: ${error.message}`);
    // Return empty array instead of throwing
    return [];
  }
};

// Check if a VPN config exists
exports.checkVpnConfigExists = async (configName) => {
  try {
    const configPath = path.join(config.vpn.basePath, `${configName}.ovpn`);
    await fs.access(configPath);
    return true;
  } catch (error) {
    return false;
  }
};

// Connect to VPN
exports.connectVpn = async (boxId, configName) => {
  try {
    const box = await Box.findById(boxId);
    
    if (!box) {
      throw new Error('Box not found');
    }
    
    if (activeVpnProcesses.has(boxId.toString())) {
      throw new Error('VPN already connected for this box');
    }
    
    // Check if config exists
    const configExists = await this.checkVpnConfigExists(configName);
    if (!configExists) {
      throw new Error(`VPN configuration "${configName}" not found`);
    }
    
    const configPath = path.join(config.vpn.basePath, `${configName}.ovpn`);
    
    // Create log directory if it doesn't exist
    const logDir = path.join(__dirname, '../logs');
    try {
      await fs.mkdir(logDir, { recursive: true });
    } catch (err) {
      // Ignore if directory already exists
    }
    
    // Generate a unique interface name for this box
    const interfaceName = `tun_box_${boxId}_${Date.now()}`;
    
    // Start OpenVPN process with route-nopull to prevent changing default routes
    const logFile = path.join(logDir, `vpn-${boxId}.log`);
    
    const vpnProcess = exec(`sudo openvpn --config ${configPath} --daemon --log ${logFile} --dev ${interfaceName} --route-nopull`);
    
    // Store the process and interface name
    activeVpnProcesses.set(boxId.toString(), vpnProcess);
    activeVpnInterfaces.set(boxId.toString(), interfaceName);
    
    // Wait for VPN to connect
    await waitForVpnConnection(logFile);
    
    // Get IP address and location using the VPN-specific method with the unique interface
    const ipInfo = await getVpnIpInfo(interfaceName);
    
    // Update box with IP and location
    box.ipAddress = ipInfo.ip;
    box.location = ipInfo.location;
    await box.save();
    
    logger.info(`VPN connection established for box ${box.name} on interface ${interfaceName}: ${ipInfo.ip} (${ipInfo.location})`);
    
    return { success: true, ip: ipInfo.ip, location: ipInfo.location };
  } catch (error) {
    logger.error(`Error connecting to VPN: ${error.message}`);
    
    // If process was started, kill it
    if (activeVpnProcesses.has(boxId.toString())) {
      try {
        const vpnProcess = activeVpnProcesses.get(boxId.toString());
        vpnProcess.kill();
        activeVpnProcesses.delete(boxId.toString());
        activeVpnInterfaces.delete(boxId.toString());
      } catch (killError) {
        logger.error(`Error killing VPN process: ${killError.message}`);
      }
    }
    
    throw new Error(`Failed to connect to VPN: ${error.message}`);
  }
};

// Disconnect from VPN
exports.disconnectVpn = async (boxId) => {
  try {
    const box = await Box.findById(boxId);
    
    if (!box) {
      throw new Error('Box not found');
    }
    
    // Get the specific process for this box
    const vpnProcess = activeVpnProcesses.get(boxId.toString());
    
    if (!vpnProcess) {
      logger.info(`No active VPN process found for box ${box.name}`);
      return { success: true };
    }
    
    // Get the process ID of the OpenVPN instance for this box
    try {
      // Find the process ID by searching for the log file pattern
      const { stdout } = await execPromise(`sudo ps aux | grep "[v]pn-${boxId}.log" | awk '{print $2}'`);
      const pid = stdout.trim();
      
      if (pid) {
        // Kill only this specific OpenVPN process
        await execPromise(`sudo kill ${pid}`);
        logger.info(`Killed OpenVPN process ${pid} for box ${box.name}`);
      } else {
        // Fall back to killing process by vpnProcess
        vpnProcess.kill();
        logger.info(`Killed VPN process via process object for box ${box.name}`);
      }
    } catch (killError) {
      logger.error(`Error killing specific VPN process: ${killError.message}`);
      
      // Fall back to killing the process directly
      try {
        vpnProcess.kill();
        logger.info(`Killed VPN process via process object for box ${box.name}`);
      } catch (directKillError) {
        logger.error(`Failed to kill VPN process directly: ${directKillError.message}`);
      }
    }
    
    // Remove from active processes and interfaces
    activeVpnProcesses.delete(boxId.toString());
    activeVpnInterfaces.delete(boxId.toString());
    
    logger.info(`VPN disconnected for box ${box.name}`);
    
    return { success: true };
  } catch (error) {
    logger.error(`Error disconnecting from VPN: ${error.message}`);
    throw new Error(`Failed to disconnect from VPN: ${error.message}`);
  }
};

// Test VPN connection
exports.testVpnConnection = async (configName) => {
  let testProcessPid = null;
  let logFile = null;
  // Use a unique interface name for each test
  const interfaceName = `tun_test_${Date.now()}`;
  
  try {
    // Check if config exists
    const configExists = await this.checkVpnConfigExists(configName);
    if (!configExists) {
      throw new Error(`VPN configuration "${configName}" not found`);
    }
    
    const configPath = path.join(config.vpn.basePath, `${configName}.ovpn`);
    logger.info(`Testing VPN connection with config: ${configPath}`);
    
    // Create temp log directory if it doesn't exist
    const tempDir = path.join(__dirname, '../temp');
    try {
      await fs.mkdir(tempDir, { recursive: true });
    } catch (err) {
      // Ignore if directory already exists
    }
    
    // Create unique identifier for this test
    const testId = Date.now();
    logFile = path.join(tempDir, `vpn-test-${testId}.log`);
    
    // First ensure there are no lingering test VPN interfaces
    try {
      await execPromise('pkill -f "openvpn --config .* --daemon --log /home/streamv3/backend/temp/vpn-test-.*"');
    } catch (error) {
      // Safe to ignore errors here - may not have any active processes
    }
    
    // Wait for any OpenVPN processes to terminate and interfaces to be removed
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Start OpenVPN process for testing with a custom device name to avoid conflicts
    try {
      logger.info(`Starting OpenVPN test with command: openvpn --config ${configPath} --daemon --log ${logFile} --dev ${interfaceName} --route-nopull`);
      await execPromise(`openvpn --config ${configPath} --daemon --log ${logFile} --dev ${interfaceName} --route-nopull`);
      
      // Get process ID for cleanup later
      const { stdout } = await execPromise(`ps aux | grep "[v]pn-test-${testId}.log" | awk '{print $2}'`);
      testProcessPid = stdout.trim();
      logger.info(`OpenVPN test process started with PID: ${testProcessPid}`);
    } catch (error) {
      logger.error(`Non-privileged OpenVPN execution failed: ${error.message}`);
      // Fall back to sudo
      logger.info(`Falling back to sudo openvpn`);
      await execPromise(`sudo openvpn --config ${configPath} --daemon --log ${logFile} --dev ${interfaceName} --route-nopull`);
      
      // Get process ID for cleanup later
      const { stdout } = await execPromise(`sudo ps aux | grep "[v]pn-test-${testId}.log" | awk '{print $2}'`);
      testProcessPid = stdout.trim();
      logger.info(`OpenVPN test process started with PID: ${testProcessPid}`);
    }
    
    // Wait for VPN to connect
    await waitForVpnConnection(logFile);
    
    // Add a small delay to ensure network interface is fully established
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get IP address and location specifically from this VPN interface
    const ipInfo = await getVpnIpInfo(interfaceName);
    
    // Kill the test process
    await cleanupTestProcess(testProcessPid);
    
    // Wait for the interface to be removed
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    logger.info(`VPN test successful: ${ipInfo.ip} (${ipInfo.location})`);
    
    return { 
      success: true, 
      config: configName,
      ip: ipInfo.ip, 
      location: ipInfo.location 
    };
  } catch (error) {
    logger.error(`Error testing VPN connection: ${error.message}`);
    
    // Cleanup if process was started
    if (testProcessPid) {
      try {
        await cleanupTestProcess(testProcessPid);
      } catch (cleanupError) {
        logger.error(`Error cleaning up test process: ${cleanupError.message}`);
      }
    }
    
    throw new Error(`Failed to test VPN connection: ${error.message}`);
  }
};

// Helper function to clean up test VPN process
async function cleanupTestProcess(pid) {
  if (!pid) return;
  
  try {
    await execPromise(`kill ${pid}`);
    logger.info(`Killed OpenVPN test process ${pid}`);
  } catch (error) {
    try {
      logger.info(`Falling back to sudo kill for PID ${pid}`);
      await execPromise(`sudo kill ${pid}`);
      logger.info(`Killed OpenVPN test process ${pid} with sudo`);
    } catch (sudoError) {
      logger.error(`Failed to kill OpenVPN test process ${pid}: ${sudoError.message}`);
    }
  }
}

// Cleanup by log file pattern if PID is unknown
async function cleanupByLogFile(logFile) {
  if (!logFile) return;
  
  try {
    const filename = path.basename(logFile);
    const { stdout } = await execPromise(`ps aux | grep "[${filename[0]}]${filename.substring(1)}" | awk '{print $2}'`);
    const pid = stdout.trim();
    
    if (pid) {
      await cleanupTestProcess(pid);
    } else {
      // Last resort - try pkill with more specific pattern
      try {
        await execPromise(`pkill -f "${filename}"`);
      } catch (pkillError) {
        try {
          await execPromise(`sudo pkill -f "${filename}"`);
        } catch (sudoPkillError) {
          // Ignore errors at this point
        }
      }
    }
  } catch (error) {
    logger.error(`Error cleaning up by log file: ${error.message}`);
  }
}

// Save a new VPN config
exports.saveVpnConfig = async (configName, configData) => {
  try {
    const configPath = path.join(config.vpn.basePath, `${configName}.ovpn`);
    
    await fs.writeFile(configPath, configData);
    
    logger.info(`VPN configuration saved: ${configName}`);
    
    return { success: true, name: configName };
  } catch (error) {
    logger.error(`Error saving VPN config: ${error.message}`);
    throw new Error(`Failed to save VPN configuration: ${error.message}`);
  }
};

// Delete a VPN config
exports.deleteVpnConfig = async (configName) => {
  try {
    const configPath = path.join(config.vpn.basePath, `${configName}.ovpn`);
    
    await fs.unlink(configPath);
    
    logger.info(`VPN configuration deleted: ${configName}`);
    
    return { success: true };
  } catch (error) {
    logger.error(`Error deleting VPN config: ${error.message}`);
    throw new Error(`Failed to delete VPN configuration: ${error.message}`);
  }
};

// Helper function to wait for VPN connection
async function waitForVpnConnection(logFile) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('VPN connection timeout'));
    }, config.vpn.connectionTimeout);
    
    const checkLog = async () => {
      try {
        const logContent = await fs.readFile(logFile, 'utf8');
        
        if (logContent.includes('Initialization Sequence Completed')) {
          clearTimeout(timeout);
          resolve();
          return;
        }
        
        // Check for common errors
        if (logContent.includes('AUTH_FAILED')) {
          clearTimeout(timeout);
          reject(new Error('VPN authentication failed'));
          return;
        }
        
        if (logContent.includes('Connection refused')) {
          clearTimeout(timeout);
          reject(new Error('VPN connection refused'));
          return;
        }
        
        // Wait and check again
        setTimeout(checkLog, 500);
      } catch (error) {
        // File may not exist yet, try again
        setTimeout(checkLog, 500);
      }
    };
    
    checkLog();
  });
}

// Get IP address and location information
async function getIpInfo() {
  try {
    // Use curl with a specific interface to get the IP from the VPN tunnel
    // This ensures we're getting the IP of the VPN connection, not the host machine
    const { stdout } = await execPromise('curl --interface tun0 https://ipinfo.io/json');
    const data = JSON.parse(stdout);
    
    return {
      ip: data.ip,
      location: `${data.city}, ${data.region}, ${data.country}`
    };
  } catch (error) {
    logger.error(`Error getting IP info: ${error.message}`);
    
    // Fallback to the regular method if the first approach fails
    try {
      const response = await axios.get('https://ipinfo.io/json');
      
      return {
        ip: response.data.ip,
        location: `${response.data.city}, ${response.data.region}, ${response.data.country}`
      };
    } catch (axiosError) {
      logger.error(`Fallback IP info also failed: ${axiosError.message}`);
      
      return {
        ip: 'Unknown',
        location: 'Unknown'
      };
    }
  }
}

// Get IP address specifically from the VPN connection
async function getVpnIpInfo(interfaceName = 'tun0') {
  try {
    // Add a timestamp to avoid cached results
    const timestamp = Date.now();
    // Specifically target the provided interface used by OpenVPN
    const { stdout } = await execPromise(`curl --interface ${interfaceName} https://ipinfo.io/json?_=${timestamp} -H "Cache-Control: no-cache"`);
    const data = JSON.parse(stdout);
    
    return {
      ip: data.ip,
      location: `${data.city}, ${data.region}, ${data.country}`
    };
  } catch (error) {
    logger.error(`Error getting VPN IP info from ${interfaceName}: ${error.message}`);
    
    // Try another approach - check ifconfig/ip for the specific interface
    try {
      // Get the IP directly from the specified interface
      const { stdout: ipOutput } = await execPromise(`ip addr show ${interfaceName} | grep 'inet ' | awk '{print $2}' | cut -d/ -f1`);
      const ip = ipOutput.trim();
      
      if (ip) {
        logger.info(`Retrieved VPN IP from interface ${interfaceName}: ${ip}`);
        
        // Try to get location data with direct HTTP request
        try {
          const timestamp = Date.now();
          const response = await axios.get(`https://ipinfo.io/${ip}/json?_=${timestamp}`, {
            headers: { 'Cache-Control': 'no-cache' }
          });
          
          return {
            ip: ip,
            location: `${response.data.city}, ${response.data.region}, ${response.data.country}`
          };
        } catch (locError) {
          return {
            ip: ip,
            location: 'Location unavailable (direct interface check)'
          };
        }
      } else {
        throw new Error(`Could not extract IP from ${interfaceName} interface`);
      }
    } catch (ifconfigError) {
      logger.error(`Fallback interface check failed: ${ifconfigError.message}`);
      
      // Last resort: use a direct HTTP request to an external IP service
      try {
        const timestamp = Date.now();
        const response = await axios.get(`https://api.ipify.org?format=json&_=${timestamp}`, {
          headers: { 
            'Pragma': 'no-cache',
            // Using a Cache-Control value that's less likely to cause CORS issues
            'Cache-Control': 'no-store'
          }
        });
        
        // Now get location data
        const locResponse = await axios.get(`https://ipinfo.io/${response.data.ip}/json?_=${timestamp}`, {
          headers: { 
            'Pragma': 'no-cache',
            // Using a Cache-Control value that's less likely to cause CORS issues
            'Cache-Control': 'no-store' 
          }
        });
        
        return {
          ip: response.data.ip,
          location: `${locResponse.data.city}, ${locResponse.data.region}, ${locResponse.data.country}`
        };
      } catch (finalError) {
        return {
          ip: 'Unknown',
          location: 'Unknown'
        };
      }
    }
  }
}