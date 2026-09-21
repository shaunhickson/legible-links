export type FilterMode = 'blocklist' | 'allowlist';
export type Theme = 'light' | 'dark' | 'system';

export interface Settings {
    enabled: boolean;
    filterMode: FilterMode;
    domainList: string[];
    matchSubdomains: boolean;
    apiUrl: string;
    theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = {
    enabled: true,
    filterMode: 'blocklist',
    domainList: [],
    matchSubdomains: true,
    apiUrl: 'https://youtube-replacer-backend-542312799814.us-east1.run.app/resolve',
    theme: 'system',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A backend URL must be https, or http to localhost only, and carry no credentials.
 */
export function isValidApiUrl(s: string): boolean {
    if (typeof s !== 'string') return false;
    let u: URL;
    try {
        u = new URL(s);
    } catch {
        return false;
    }
    if (u.username || u.password) return false;
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:') return LOCAL_HOSTS.has(u.hostname.toLowerCase());
    return false;
}

export async function getSettings(): Promise<Settings> {
    return new Promise((resolve) => {
        chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
            const settings = { ...DEFAULT_SETTINGS, ...(items as Partial<Settings>) };
            if (!isValidApiUrl(settings.apiUrl)) {
                settings.apiUrl = DEFAULT_SETTINGS.apiUrl;
            }
            resolve(settings);
        });
    });
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.set(settings, () => {
            resolve();
        });
    });
}

/**
 * Checks if a given domain should be processed based on the user's settings.
 */
export function isDomainAllowed(domain: string, settings: Settings): boolean {
    if (!settings.enabled) return false;

    const normalizedDomain = domain.toLowerCase();
    let isMatch = false;

    for (const item of settings.domainList) {
        const normalizedItem = item.toLowerCase();
        if (normalizedDomain === normalizedItem) {
            isMatch = true;
            break;
        }
        if (settings.matchSubdomains && normalizedDomain.endsWith('.' + normalizedItem)) {
            isMatch = true;
            break;
        }
    }

    if (settings.filterMode === 'blocklist') {
        return !isMatch;
    } else {
        return isMatch;
    }
}

/**
 * Extracts the domain from a URL string.
 */
export function getDomain(url: string): string {
    try {
        const u = new URL(url);
        return u.hostname;
    } catch {
        return '';
    }
}
