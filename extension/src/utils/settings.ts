export type FilterMode = 'blocklist' | 'allowlist';
export type Theme = 'light' | 'dark' | 'system';
/** Tier A (YouTube, Spotify, X, Reddit, Vimeo): ask the platform automatically, or only on hover. */
export type PlatformMode = 'auto' | 'hover';
/** Tier B (everything else, via our server): never, only on hover, or automatically. */
export type GenericMode = 'off' | 'hover' | 'auto';
export type ModeName = 'private' | 'balanced' | 'everything' | 'custom';

export interface Settings {
    enabled: boolean;
    filterMode: FilterMode;
    domainList: string[];
    matchSubdomains: boolean;
    apiUrl: string;
    theme: Theme;
    platformMode: PlatformMode;
    genericMode: GenericMode;
    onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
    enabled: true,
    filterMode: 'blocklist',
    domainList: [],
    matchSubdomains: true,
    apiUrl: 'https://youtube-replacer-backend-542312799814.us-east1.run.app/resolve',
    theme: 'system',
    platformMode: 'auto',
    genericMode: 'hover',
    onboarded: false,
};

export type ModePreset = Pick<Settings, 'platformMode' | 'genericMode'>;

/** The three privacy presets; Balanced is the default install. Tier 0 (local) is always automatic. */
export const MODE_PRESETS: Record<Exclude<ModeName, 'custom'>, ModePreset> = {
    private: { platformMode: 'hover', genericMode: 'off' },
    balanced: { platformMode: 'auto', genericMode: 'hover' },
    everything: { platformMode: 'auto', genericMode: 'auto' },
};

export const MODE_LABELS: Record<ModeName, string> = {
    private: 'Private',
    balanced: 'Balanced',
    everything: 'Everything',
    custom: 'Custom',
};

export function modeName(settings: ModePreset): ModeName {
    for (const [name, preset] of Object.entries(MODE_PRESETS) as [Exclude<ModeName, 'custom'>, ModePreset][]) {
        if (preset.platformMode === settings.platformMode && preset.genericMode === settings.genericMode) return name;
    }
    return 'custom';
}

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

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

/**
 * Builds a complete, valid Settings object from whatever is in storage.
 * Unknown or malformed values fall back to the defaults, field by field.
 */
export function normalizeSettings(items: unknown): Settings {
    const raw: Record<string, unknown> = typeof items === 'object' && items !== null ? (items as Record<string, unknown>) : {};
    const d = DEFAULT_SETTINGS;
    return {
        enabled: bool(raw.enabled, d.enabled),
        filterMode: oneOf(raw.filterMode, ['blocklist', 'allowlist'], d.filterMode),
        domainList: Array.isArray(raw.domainList) ? raw.domainList.filter((x): x is string => typeof x === 'string') : d.domainList,
        matchSubdomains: bool(raw.matchSubdomains, d.matchSubdomains),
        apiUrl: typeof raw.apiUrl === 'string' && isValidApiUrl(raw.apiUrl) ? raw.apiUrl : d.apiUrl,
        theme: oneOf(raw.theme, ['light', 'dark', 'system'], d.theme),
        platformMode: oneOf(raw.platformMode, ['auto', 'hover'], d.platformMode),
        genericMode: oneOf(raw.genericMode, ['off', 'hover', 'auto'], d.genericMode),
        onboarded: bool(raw.onboarded, d.onboarded),
    };
}

export async function getSettings(): Promise<Settings> {
    return new Promise((resolve) => {
        chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
            resolve(normalizeSettings(items));
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
