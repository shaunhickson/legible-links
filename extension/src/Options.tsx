import React, { useEffect, useState } from 'react';
import './Popup.css'; // Reuse basic styles
import { getSettings, saveSettings, isValidApiUrl, Settings, DEFAULT_SETTINGS, FilterMode, Theme } from './utils/settings';

const API_URL_ERROR = 'Enter an https:// URL (http:// is only allowed for localhost). The last valid URL stays in use.';

const Options: React.FC = () => {
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
    const [apiUrlInput, setApiUrlInput] = useState<string>(DEFAULT_SETTINGS.apiUrl);
    const [apiUrlError, setApiUrlError] = useState<string | null>(null);
    const [newDomain, setNewDomain] = useState('');
    const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

    useEffect(() => {
        getSettings().then((loaded) => {
            setSettings(loaded);
            setApiUrlInput(loaded.apiUrl);
        });
    }, []);

    const handleSave = async (updated: Partial<Settings>) => {
        const newSettings = { ...settings, ...updated };
        await saveSettings(newSettings);
        setSettings(newSettings);
    };

    const handleApiUrlChange = (value: string) => {
        setApiUrlInput(value);
        const trimmed = value.trim();
        if (isValidApiUrl(trimmed)) {
            setApiUrlError(null);
            handleSave({ apiUrl: trimmed });
        } else {
            setApiUrlError(API_URL_ERROR);
        }
    };

    const addDomain = () => {
        const domain = newDomain.trim().toLowerCase();
        if (domain && !settings.domainList.includes(domain)) {
            handleSave({ domainList: [...settings.domainList, domain] });
            setNewDomain('');
        }
    };

    const removeDomain = (domain: string) => {
        handleSave({ domainList: settings.domainList.filter(d => d !== domain) });
    };

    const testConnection = async () => {
        setTestStatus('testing');
        try {
            const healthUrl = settings.apiUrl.replace('/resolve', '/health');
            const resp = await fetch(healthUrl);
            if (resp.ok) {
                setTestStatus('success');
            } else {
                setTestStatus('error');
            }
        } catch {
            setTestStatus('error');
        }
        setTimeout(() => setTestStatus('idle'), 3000);
    };

    const resetApiUrl = () => {
        setApiUrlInput(DEFAULT_SETTINGS.apiUrl);
        setApiUrlError(null);
        handleSave({ apiUrl: DEFAULT_SETTINGS.apiUrl });
    };

    return (
        <div className="container" style={{ width: '450px', margin: '20px auto' }}>
            <div className="header">
                <h1>Legible Links Settings</h1>
            </div>

            <div className="content">
                {/* Connection Section */}
                <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div className="label-text">Backend Connection (Self-Hosting)</div>
                    <input 
                        type="url" 
                        value={apiUrlInput}
                        onChange={(e) => handleApiUrlChange(e.target.value)}
                        aria-invalid={apiUrlError !== null}
                        aria-describedby={apiUrlError ? 'api-url-error' : undefined}
                        style={{ width: '100%', padding: '8px', marginTop: '8px', boxSizing: 'border-box', borderColor: apiUrlError ? '#ff4444' : undefined }}
                    />
                    {apiUrlError && (
                        <div id="api-url-error" role="alert" style={{ color: '#ff4444', fontSize: '12px', marginTop: '6px' }}>
                            {apiUrlError}
                        </div>
                    )}
                    <div style={{ marginTop: '8px', display: 'flex', gap: '8px', width: '100%' }}>
                        <button onClick={testConnection} className="btn" disabled={testStatus === 'testing' || apiUrlError !== null} style={{ flex: 1, margin: 0 }}>
                            {testStatus === 'idle' && 'Test Connection'}
                            {testStatus === 'testing' && 'Testing...'}
                            {testStatus === 'success' && '✅ Success!'}
                            {testStatus === 'error' && '❌ Failed'}
                        </button>
                        <button onClick={resetApiUrl} className="btn" style={{ flex: 1, margin: 0, backgroundColor: '#888' }}>
                            Reset to Default
                        </button>
                    </div>
                </div>

                {/* Appearance Section */}
                <div className="card">
                    <div>
                        <div className="label-text">Tooltip Theme</div>
                        <div className="status" style={{ fontSize: '12px' }}>Choose the look of your link tooltips</div>
                    </div>
                    <select 
                        value={settings.theme} 
                        onChange={(e) => handleSave({ theme: e.target.value as Theme })}
                        style={{ padding: '4px' }}
                    >
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                        <option value="system">System Default</option>
                    </select>
                </div>

                {/* Filtering Section */}
                <div className="card">
                    <div>
                        <div className="label-text">Filtering Mode</div>
                        <div className="status" style={{ fontSize: '12px' }}>
                            {settings.filterMode === 'blocklist' 
                                ? 'Resolving all EXCEPT these domains' 
                                : 'ONLY resolving these domains'}
                        </div>
                    </div>
                    <select 
                        value={settings.filterMode} 
                        onChange={(e) => handleSave({ filterMode: e.target.value as FilterMode })}
                        style={{ padding: '4px' }}
                    >
                        <option value="blocklist">Blocklist</option>
                        <option value="allowlist">Allowlist</option>
                    </select>
                </div>

                <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div className="label-text">Domain List</div>
                    <div style={{ display: 'flex', width: '100%', marginTop: '8px' }}>
                        <input 
                            type="text" 
                            placeholder="example.com" 
                            value={newDomain}
                            onChange={(e) => setNewDomain(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addDomain()}
                            style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px 0 0 4px' }}
                        />
                        <button 
                            onClick={addDomain}
                            className="btn"
                            style={{ margin: 0, borderRadius: '0 4px 4px 0', padding: '8px 16px' }}
                        >
                            Add
                        </button>
                    </div>
                    <ul style={{ width: '100%', padding: 0, marginTop: '12px', listStyle: 'none' }}>
                        {settings.domainList.map(domain => (
                            <li key={domain} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                                <span>{domain}</span>
                                <button 
                                    onClick={() => removeDomain(domain)}
                                    style={{ border: 'none', background: 'none', color: '#ff4444', cursor: 'pointer' }}
                                >
                                    Remove
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="card">
                    <div>
                        <div className="label-text">Match Subdomains</div>
                        <div className="status" style={{ fontSize: '12px' }}>e.g. corp.com also blocks dev.corp.com</div>
                    </div>
                    <label className="switch">
                        <input 
                            type="checkbox" 
                            checked={settings.matchSubdomains} 
                            onChange={(e) => handleSave({ matchSubdomains: e.target.checked })} 
                        />
                        <span className="slider"></span>
                    </label>
                </div>
            </div>

            <div className="footer">
                Privacy settings are stored locally in your browser.
            </div>
        </div>
    );
};

export default Options;
