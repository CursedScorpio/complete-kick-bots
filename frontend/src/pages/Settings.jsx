// src/pages/Settings.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Spinner from '../components/UI/Spinner';
import api from '../services/api';

const Settings = () => {
  const { vpnConfigs, vpnLoading, vpnError, fetchVpnConfigs, testVpnConnection, deleteVpnConfig } = useAppContext();
  
  const [selectedFile, setSelectedFile] = useState(null);
  const [configName, setConfigName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [isTesting, setIsTesting] = useState({});
  
  const fileInputRef = useRef(null);
  
  // Fetch VPN configs if not already loaded
  useEffect(() => {
    if (vpnConfigs.length === 0 && !vpnLoading) {
      fetchVpnConfigs();
    }
  }, [vpnConfigs, vpnLoading, fetchVpnConfigs]);
  
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      
      // Extract name from filename without extension
      const nameWithoutExtension = file.name.replace(/\.[^/.]+$/, "");
      setConfigName(nameWithoutExtension);
    }
  };
  
  const handleConfigNameChange = (e) => {
    setConfigName(e.target.value);
  };
  
  const handleUpload = async (e) => {
    e.preventDefault();
    
    if (!selectedFile) {
      setUploadError('Please select a file to upload');
      return;
    }
    
    if (!configName.trim()) {
      setUploadError('Please provide a name for the VPN configuration');
      return;
    }
    
    setIsUploading(true);
    setUploadError(null);
    
    const formData = new FormData();
    formData.append('config', selectedFile);
    formData.append('name', configName);
    
    try {
      await api.post('/vpn/configs', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      // Reset form
      setSelectedFile(null);
      setConfigName('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      
      // Refresh VPN configs
      fetchVpnConfigs();
    } catch (error) {
      console.error('Error uploading VPN config:', error);
      setUploadError(error.response?.data?.message || 'Failed to upload VPN configuration');
    } finally {
      setIsUploading(false);
    }
  };
  
  const handleTestConnection = async (configName) => {
    setIsTesting(prev => ({ ...prev, [configName]: true }));
    setTestResults(prev => ({ ...prev, [configName]: null }));
    
    try {
      const result = await testVpnConnection(configName);
      setTestResults(prev => ({ 
        ...prev, 
        [configName]: { 
          success: true, 
          ip: result.ip, 
          location: result.location 
        } 
      }));
    } catch (error) {
      console.error('Error testing VPN connection:', error);
      setTestResults(prev => ({ 
        ...prev, 
        [configName]: { 
          success: false, 
          error: error.response?.data?.message || 'Connection test failed' 
        } 
      }));
    } finally {
      setIsTesting(prev => ({ ...prev, [configName]: false }));
    }
  };
  
  const handleDeleteConfig = async (configName) => {
    if (window.confirm(`Are you sure you want to delete the VPN configuration "${configName}"?`)) {
      try {
        await deleteVpnConfig(configName);
        // Clear test results for this config
        setTestResults(prev => {
          const newResults = { ...prev };
          delete newResults[configName];
          return newResults;
        });
      } catch (error) {
        console.error('Error deleting VPN config:', error);
      }
    }
  };
  
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your VPN configurations and system settings
        </p>
      </div>
      
      {/* VPN Configurations */}
      <Card title="VPN Configurations">
        <div className="space-y-6">
          {/* Upload Form */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Upload New VPN Configuration</h3>
            <form onSubmit={handleUpload} className="space-y-4">
              {uploadError && (
                <div className="text-sm text-danger-600 bg-danger-50 p-3 rounded-md">
                  {uploadError}
                </div>
              )}
              
              <div>
                <label htmlFor="vpn-file" className="block text-sm font-medium text-gray-700">
                  OpenVPN Config File (.ovpn)
                </label>
                <input
                  type="file"
                  id="vpn-file"
                  ref={fileInputRef}
                  accept=".ovpn"
                  onChange={handleFileChange}
                  className="mt-1 block w-full text-sm text-gray-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-md file:border-0
                    file:text-sm file:font-medium
                    file:bg-primary-50 file:text-primary-700
                    hover:file:bg-primary-100"
                />
              </div>
              
              <div>
                <label htmlFor="config-name" className="block text-sm font-medium text-gray-700">
                  Configuration Name
                </label>
                <input
                  type="text"
                  id="config-name"
                  value={configName}
                  onChange={handleConfigNameChange}
                  placeholder="Enter a name for this VPN configuration"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                />
              </div>
              
              <div>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <>
                      <Spinner size="sm" className="mr-2" />
                      Uploading...
                    </>
                  ) : (
                    'Upload Configuration'
                  )}
                </Button>
              </div>
            </form>
          </div>
          
          {/* VPN Configs List */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Available VPN Configurations</h3>
            
            {vpnLoading ? (
              <div className="flex justify-center items-center py-8">
                <Spinner size="md" />
              </div>
            ) : vpnError ? (
              <div className="text-sm text-danger-600 bg-danger-50 p-3 rounded-md">
                Error loading VPN configurations: {vpnError}
              </div>
            ) : vpnConfigs.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No VPN configurations available. Upload one to get started.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        Name
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        Path
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        Status
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {vpnConfigs.map((config) => (
                      <tr key={config.name}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {config.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {config.fullPath}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {testResults[config.name] ? (
                            testResults[config.name].success ? (
                              <div>
                                <span className="text-success-600">Success</span>
                                <div className="text-xs text-gray-500">
                                  {testResults[config.name].ip} ({testResults[config.name].location})
                                </div>
                              </div>
                            ) : (
                              <div>
                                <span className="text-danger-600">Failed</span>
                                <div className="text-xs text-gray-500">
                                  {testResults[config.name].error}
                                </div>
                              </div>
                            )
                          ) : (
                            <span className="text-gray-500">Not tested</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex justify-end space-x-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleTestConnection(config.name)}
                              disabled={isTesting[config.name]}
                            >
                              {isTesting[config.name] ? (
                                <>
                                  <Spinner size="sm" className="mr-1" />
                                  Testing...
                                </>
                              ) : (
                                'Test'
                              )}
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleDeleteConfig(config.name)}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Card>
      
      {/* System Settings (Optional) */}
      <Card title="System Settings">
        <p className="text-sm text-gray-500 mb-4">
          Configure global settings for the Kick Viewer Simulator.
        </p>
        
        <form className="space-y-4">
          <div>
            <label htmlFor="update-interval" className="block text-sm font-medium text-gray-700">
              Update Interval (seconds)
            </label>
            <input
              type="number"
              id="update-interval"
              min="1"
              max="60"
              defaultValue="5"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              How often viewers should update their status and stream data.
            </p>
          </div>
          
          <div>
            <label htmlFor="reconnect-interval" className="block text-sm font-medium text-gray-700">
              Reconnect Interval (seconds)
            </label>
            <input
              type="number"
              id="reconnect-interval"
              min="30"
              max="600"
              defaultValue="60"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              How long to wait before attempting to reconnect a disconnected viewer.
            </p>
          </div>
          
          <div className="pt-4">
            <Button variant="primary" disabled>
              Save Settings
            </Button>
            <p className="mt-2 text-xs text-gray-500 italic">
              Note: Settings management is currently disabled as it requires server restart.
              Edit the config file directly to change these settings.
            </p>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default Settings;