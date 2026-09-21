import React, { useEffect, useState } from 'react';
import './Popup.css';
import { getSettings, saveSettings, Settings, DEFAULT_SETTINGS, getDomain, isDomainAllowed } from './utils/settings';

const Popup: React.FC = () => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [currentTabDomain, setCurrentTabDomain] = useState<string>('');

  useEffect(() => {
    // Load settings
    getSettings().then(setSettings);

    // Get current tab domain
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        setCurrentTabDomain(getDomain(tabs[0].url));
      }
    });
  }, []);

  const handleToggleGlobal = async () => {
    const newEnabled = !settings.enabled;
    await saveSettings({ enabled: newEnabled });
    setSettings({ ...settings, enabled: newEnabled });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.reload(tabs[0].id);
      }
    });
  };

  const isCurrentSiteAllowed = isDomainAllowed(currentTabDomain, settings);

  const handleToggleCurrentSite = async () => {
    let newList = [...settings.domainList];
    const normalizedDomain = currentTabDomain.toLowerCase();

    if (isCurrentSiteAllowed) {
      // We want to block it
      if (settings.filterMode === 'blocklist') {
        if (!newList.includes(normalizedDomain)) newList.push(normalizedDomain);
      } else {
        newList = newList.filter(d => d.toLowerCase() !== normalizedDomain);
      }
    } else {
      // We want to allow it
      if (settings.filterMode === 'allowlist') {
        if (!newList.includes(normalizedDomain)) newList.push(normalizedDomain);
      } else {
        newList = newList.filter(d => d.toLowerCase() !== normalizedDomain);
      }
    }

    await saveSettings({ domainList: newList });
    setSettings({ ...settings, domainList: newList });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.reload(tabs[0].id);
      }
    });
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div className="container">
      <div className="header">
        <img src="/icons/icon.svg" alt="Logo" style={{ width: '24px', height: '24px', marginRight: '8px' }} />
        <h1>Legible Links</h1>
      </div>

      <div className="content">
        <div className="card">
          <div>
            <div className="label-text">Extension Status</div>
            <div className="status">{settings.enabled ? 'Active' : 'Disabled'}</div>
          </div>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={settings.enabled} 
              onChange={handleToggleGlobal} 
            />
            <span className="slider"></span>
          </label>
        </div>

        {settings.enabled && currentTabDomain && (
          <div className="card">
            <div>
              <div className="label-text">Active on this site</div>
              <div className="status">{isCurrentSiteAllowed ? 'Yes' : 'No'}</div>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={isCurrentSiteAllowed} 
                onChange={handleToggleCurrentSite} 
              />
              <span className="slider"></span>
            </label>
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <button className="btn" onClick={openOptions}>
            Advanced Privacy Settings
          </button>
        </div>
      </div>

      <div className="footer">
        Transparency for the Web
      </div>
    </div>
  );
};

export default Popup;