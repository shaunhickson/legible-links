import React, { useEffect, useState } from 'react';
import './Popup.css'; // Reuse basic styles
import {
    getSettings, saveSettings, modeName, ModeName, MODE_DESCRIPTIONS, MODE_LABELS, MODE_PRESETS, PRESET_ORDER,
} from './utils/settings';

export const PRIVACY_POLICY_URL = 'https://shaunhickson.github.io/legible-links/privacy/';

type Preset = Exclude<ModeName, 'custom'>;

const EXAMPLE_BEFORE = 'https://youtu.be/dQw4w9WgXcQ';
const EXAMPLE_AFTER_TITLE = 'Rick Astley - Never Gonna Give You Up';
const EXAMPLE_AFTER_HOST = 'youtube.com';

/**
 * Shown once, in a tab, right after install. One paragraph on what the
 * extension does, the three privacy presets (the same sentences the options
 * page uses), and a Continue button that records the choice.
 */
const Onboarding: React.FC = () => {
    const [choice, setChoice] = useState<Preset>('balanced');
    const [saved, setSaved] = useState<Preset | null>(null);

    useEffect(() => {
        // A revisit shows the mode already in force; a fresh install is Balanced.
        getSettings().then((settings) => {
            const current = modeName(settings);
            if (current !== 'custom') setChoice(current);
        });
    }, []);

    const finish = async () => {
        await saveSettings({ ...MODE_PRESETS[choice], onboarded: true });
        setSaved(choice);
    };

    const openOptions = () => {
        chrome.runtime.openOptionsPage();
    };

    return (
        <div className="container" style={{ maxWidth: '560px', margin: '20px auto' }}>
            <div className="header">
                <img src="/icons/icon.svg" alt="" style={{ width: '24px', height: '24px', marginRight: '8px' }} />
                <h1 style={{ flex: 1 }}>Welcome to Legible Links</h1>
            </div>

            <div className="content">
                <p style={{ marginTop: 0, lineHeight: 1.5 }}>
                    Legible Links turns raw URLs in link text into readable titles and always shows where the link goes;
                    the link itself is never changed.
                </p>

                <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }} aria-label="Example">
                    <div className="status" style={{ marginTop: 0 }}>Before</div>
                    <code style={{ fontSize: '13px', wordBreak: 'break-all' }}>{EXAMPLE_BEFORE}</code>
                    <div className="status">After</div>
                    <div style={{ fontSize: '14px' }}>
                        <span style={{ marginRight: '4px' }} aria-hidden="true">&#9654;</span>
                        <span>{EXAMPLE_AFTER_TITLE}</span>
                        <span style={{ opacity: 0.7, fontSize: '0.85em' }}> · {EXAMPLE_AFTER_HOST}</span>
                    </div>
                </div>

                {saved === null ? (
                    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        <div className="label-text">Choose a privacy mode</div>
                        <div className="status" style={{ marginBottom: '8px' }}>
                            Wikipedia, GitHub, Reddit, Stack Overflow and Amazon links are always read from the URL itself, with no network at all.
                            You can change this at any time in the options page.
                        </div>
                        <div role="radiogroup" aria-label="Privacy mode">
                            {PRESET_ORDER.map((name) => (
                                <label key={name} className="mode-card" style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', border: '1px solid #e0e0e0', borderRadius: '6px', marginBottom: '8px', cursor: 'pointer' }}>
                                    <input
                                        type="radio"
                                        name="onboarding-mode"
                                        value={name}
                                        checked={choice === name}
                                        onChange={() => setChoice(name)}
                                        style={{ marginTop: '3px' }}
                                    />
                                    <span>
                                        <span style={{ fontWeight: 500 }}>{MODE_LABELS[name]}{name === 'balanced' ? ' (recommended)' : ''}</span>
                                        <span className="status" style={{ display: 'block' }}>{MODE_DESCRIPTIONS[name]}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        <button className="btn" onClick={finish} style={{ alignSelf: 'flex-end', marginTop: '4px' }}>
                            Continue
                        </button>
                    </div>
                ) : (
                    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }} role="status">
                        <div className="label-text">You&apos;re set</div>
                        <div className="status">
                            Legible Links is running in {MODE_LABELS[saved]} mode. You can close this tab.
                        </div>
                    </div>
                )}

                <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', fontSize: '13px' }}>
                    <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">Privacy policy</a>
                    <button
                        type="button"
                        onClick={openOptions}
                        style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}
                    >
                        All settings
                    </button>
                </div>
            </div>

            <div className="footer">
                Your choice is stored locally in your browser. Nothing is collected.
            </div>
        </div>
    );
};

export default Onboarding;
