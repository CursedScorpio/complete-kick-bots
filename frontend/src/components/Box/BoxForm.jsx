// src/components/Box/BoxForm.jsx
import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import Button from '../UI/Button';
import Modal from '../UI/Modal';
import Spinner from '../UI/Spinner';

const BoxForm = ({ isOpen, onClose, box = null, isEdit = false }) => {
  const { vpnConfigs, vpnLoading, createBox, updateBox, fetchVpnConfigs } = useAppContext();
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    vpnConfig: '',
    streamUrl: '',
    viewersPerBox: 10,
    defaultMaxTabs: 1,
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  
  // Populate form with box data when editing
  useEffect(() => {
    if (isEdit && box) {
      setFormData({
        name: box.name || '',
        vpnConfig: box.vpnConfig || '',
        streamUrl: box.streamUrl || '',
        viewersPerBox: box.viewersPerBox || 10,
        defaultMaxTabs: box.defaultMaxTabs || 1,
      });
    } else {
      setFormData({
        name: '',
        vpnConfig: vpnConfigs[0]?.name || '',
        streamUrl: '',
        viewersPerBox: 10,
        defaultMaxTabs: 1,
      });
    }
  }, [isEdit, box, vpnConfigs]);
  
  // Fetch VPN configs if needed
  useEffect(() => {
    if (isOpen && vpnConfigs.length === 0 && !vpnLoading) {
      fetchVpnConfigs();
    }
  }, [isOpen, vpnConfigs, vpnLoading, fetchVpnConfigs]);
  
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    
    // Clear error on change
    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: null,
      }));
    }
  };
  
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }
    
    if (!formData.vpnConfig.trim()) {
      newErrors.vpnConfig = 'VPN configuration is required';
    }
    
    // Validate stream URL format if provided
    if (formData.streamUrl.trim() && !formData.streamUrl.match(/^https?:\/\/(www\.)?kick\.com\/[a-zA-Z0-9_-]+$/)) {
      newErrors.streamUrl = 'Invalid Kick.com URL (e.g., https://kick.com/streamername)';
    }
    
    // Validate viewers per box
    const viewersPerBox = parseInt(formData.viewersPerBox, 10);
    if (isNaN(viewersPerBox) || viewersPerBox < 1 || viewersPerBox > 50) {
      newErrors.viewersPerBox = 'Viewers per box must be between 1 and 50';
    }
    
    // Validate default max tabs
    const defaultMaxTabs = parseInt(formData.defaultMaxTabs, 10);
    if (isNaN(defaultMaxTabs) || defaultMaxTabs < 1 || defaultMaxTabs > 10) {
      newErrors.defaultMaxTabs = 'Default max tabs must be between 1 and 10';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      if (isEdit && box) {
        await updateBox(box._id, formData);
      } else {
        await createBox(formData);
      }
      
      onClose();
    } catch (error) {
      console.error('Form submission error:', error);
      
      // Check for specific API errors
      if (error.response?.data?.message) {
        setErrors((prev) => ({
          ...prev,
          api: error.response.data.message,
        }));
      }
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const modalFooter = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
        Cancel
      </Button>
      <Button
        variant="primary"
        onClick={handleSubmit}
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <>
            <Spinner size="sm" className="mr-2" />
            {isEdit ? 'Updating...' : 'Creating...'}
          </>
        ) : (
          isEdit ? 'Update Box' : 'Create Box'
        )}
      </Button>
    </>
  );
  
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Box' : 'Create New Box'}
      footer={modalFooter}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* API Error */}
        {errors.api && (
          <div className="p-3 bg-danger-50 text-danger-700 rounded-md text-sm">
            {errors.api}
          </div>
        )}
        
        {/* Name Field */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Box Name
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm ${
              errors.name ? 'border-danger-300' : ''
            }`}
            placeholder="Enter box name"
          />
          {errors.name && (
            <p className="mt-1 text-sm text-danger-600">{errors.name}</p>
          )}
        </div>
        
        {/* VPN Config Field */}
        <div>
          <label htmlFor="vpnConfig" className="block text-sm font-medium text-gray-700">
            VPN Configuration
          </label>
          
          {vpnLoading ? (
            <div className="mt-1 flex items-center">
              <Spinner size="sm" />
              <span className="ml-2 text-sm text-gray-500">Loading VPN configurations...</span>
            </div>
          ) : vpnConfigs.length === 0 ? (
            <div className="mt-1 text-sm text-gray-500">
              No VPN configurations available. Please add one in the Settings.
            </div>
          ) : (
            <select
              id="vpnConfig"
              name="vpnConfig"
              value={formData.vpnConfig}
              onChange={handleChange}
              className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm ${
                errors.vpnConfig ? 'border-danger-300' : ''
              }`}
            >
              <option value="" disabled>
                Select VPN configuration
              </option>
              {vpnConfigs.map((config) => (
                <option key={config.name} value={config.name}>
                  {config.name}
                </option>
              ))}
            </select>
          )}
          
          {errors.vpnConfig && (
            <p className="mt-1 text-sm text-danger-600">{errors.vpnConfig}</p>
          )}
        </div>
        
        {/* Stream URL Field */}
        <div>
          <label htmlFor="streamUrl" className="block text-sm font-medium text-gray-700">
            Stream URL (Optional)
          </label>
          <input
            type="text"
            id="streamUrl"
            name="streamUrl"
            value={formData.streamUrl}
            onChange={handleChange}
            className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm ${
              errors.streamUrl ? 'border-danger-300' : ''
            }`}
            placeholder="https://kick.com/streamer"
          />
          {errors.streamUrl ? (
            <p className="mt-1 text-sm text-danger-600">{errors.streamUrl}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">
              Leave empty to set stream URL later per viewer
            </p>
          )}
        </div>
        
        {/* Viewers Per Box Field */}
        <div>
          <label htmlFor="viewersPerBox" className="block text-sm font-medium text-gray-700">
            Viewers Per Box
          </label>
          <input
            type="number"
            id="viewersPerBox"
            name="viewersPerBox"
            value={formData.viewersPerBox}
            onChange={handleChange}
            min="1"
            max="50"
            className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm ${
              errors.viewersPerBox ? 'border-danger-300' : ''
            }`}
          />
          {errors.viewersPerBox ? (
            <p className="mt-1 text-sm text-danger-600">{errors.viewersPerBox}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">
              Number of viewers to create in this box (1-50)
            </p>
          )}
        </div>
        
        {/* Default Max Tabs Field */}
        <div>
          <label htmlFor="defaultMaxTabs" className="block text-sm font-medium text-gray-700">
            Default Max Tabs Per Viewer
          </label>
          <input
            type="number"
            id="defaultMaxTabs"
            name="defaultMaxTabs"
            value={formData.defaultMaxTabs}
            onChange={handleChange}
            min="1"
            max="10"
            className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm ${
              errors.defaultMaxTabs ? 'border-danger-300' : ''
            }`}
          />
          {errors.defaultMaxTabs ? (
            <p className="mt-1 text-sm text-danger-600">{errors.defaultMaxTabs}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">
              Maximum number of tabs each viewer can have (1-10)
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
};

export default BoxForm;
