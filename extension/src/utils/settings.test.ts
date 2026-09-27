import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, isDomainAllowed, modeName, MODE_PRESETS, normalizeSettings, Settings, getDomain } from './settings';

describe('Settings Utilities', () => {
    const baseSettings: Settings = {
        enabled: true,
        filterMode: 'blocklist',
        domainList: ['example.com'],
        matchSubdomains: true,
        apiUrl: 'https://test.com/resolve',
        theme: 'system',
        platformMode: 'auto',
        genericMode: 'hover',
        onboarded: false,
    };

    describe('getDomain', () => {
        it('extracts hostname from valid URLs', () => {
            expect(getDomain('https://google.com/search')).toBe('google.com');
            expect(getDomain('http://sub.test.org')).toBe('sub.test.org');
        });

        it('returns empty string for invalid URLs', () => {
            expect(getDomain('not-a-url')).toBe('');
        });
    });

    describe('isDomainAllowed', () => {
        it('blocks domains in blocklist mode', () => {
            expect(isDomainAllowed('example.com', baseSettings)).toBe(false);
            expect(isDomainAllowed('google.com', baseSettings)).toBe(true);
        });

        it('blocks subdomains if enabled', () => {
            expect(isDomainAllowed('sub.example.com', baseSettings)).toBe(false);
        });

        it('does not block subdomains if disabled', () => {
            const noSubSettings = { ...baseSettings, matchSubdomains: false };
            expect(isDomainAllowed('sub.example.com', noSubSettings)).toBe(true);
        });

        it('allows only listed domains in allowlist mode', () => {
            const allowSettings: Settings = {
                ...baseSettings,
                filterMode: 'allowlist',
                domainList: ['trusted.com'],
            };
            expect(isDomainAllowed('trusted.com', allowSettings)).toBe(true);
            expect(isDomainAllowed('sub.trusted.com', allowSettings)).toBe(true);
            expect(isDomainAllowed('example.com', allowSettings)).toBe(false);
        });

        it('returns false if extension is disabled', () => {
            const disabledSettings = { ...baseSettings, enabled: false };
            expect(isDomainAllowed('any.com', disabledSettings)).toBe(false);
        });
        
        it('is case-insensitive', () => {
            expect(isDomainAllowed('EXAMPLE.COM', baseSettings)).toBe(false);
        });
    });
});

describe('privacy modes', () => {
    it('defaults to Balanced: platforms automatically, everything else on hover', () => {
        expect(DEFAULT_SETTINGS.platformMode).toBe('auto');
        expect(DEFAULT_SETTINGS.genericMode).toBe('hover');
        expect(modeName(DEFAULT_SETTINGS)).toBe('balanced');
    });

    it('names each preset and anything else Custom', () => {
        expect(modeName(MODE_PRESETS.private)).toBe('private');
        expect(modeName(MODE_PRESETS.balanced)).toBe('balanced');
        expect(modeName(MODE_PRESETS.everything)).toBe('everything');
        expect(modeName({ platformMode: 'hover', genericMode: 'hover' })).toBe('custom');
        expect(modeName({ platformMode: 'hover', genericMode: 'auto' })).toBe('custom');
        expect(modeName({ platformMode: 'auto', genericMode: 'off' })).toBe('custom');
    });

    it('Private never contacts our server and asks platforms only on hover', () => {
        expect(MODE_PRESETS.private).toEqual({ platformMode: 'hover', genericMode: 'off' });
        expect(MODE_PRESETS.everything).toEqual({ platformMode: 'auto', genericMode: 'auto' });
    });
});

describe('normalizeSettings', () => {
    it('fills defaults for missing or malformed fields, one field at a time', () => {
        const s = normalizeSettings({
            enabled: 'yes',
            filterMode: 'denylist',
            domainList: ['a.example', 7, 'b.example'],
            apiUrl: 'http://evil.example/resolve',
            theme: 'neon',
            platformMode: 'always',
            genericMode: 'auto',
            onboarded: 1,
        });
        expect(s).toEqual({ ...DEFAULT_SETTINGS, domainList: ['a.example', 'b.example'], genericMode: 'auto' });
    });

    it('keeps valid values', () => {
        const valid: Settings = {
            enabled: false,
            filterMode: 'allowlist',
            domainList: ['x.example'],
            matchSubdomains: false,
            apiUrl: 'http://localhost:8080/resolve',
            theme: 'dark',
            platformMode: 'hover',
            genericMode: 'off',
            onboarded: true,
        };
        expect(normalizeSettings(valid)).toEqual(valid);
        expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    });
});
