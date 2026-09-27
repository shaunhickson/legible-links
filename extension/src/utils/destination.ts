/** Where a link lands, for display next to the host the href names. */

export function hostnameOf(url: string): string | null {
    try {
        const host = new URL(url).hostname;
        return host || null;
    } catch {
        return null;
    }
}

/** The final hostname when `finalUrl` is usable and lands on a different host; otherwise null. */
export function destinationHost(href: string, finalUrl: string | undefined): string | null {
    if (!finalUrl) return null;
    const original = hostnameOf(href);
    const final = hostnameOf(finalUrl);
    if (!original || !final || final.toLowerCase() === original.toLowerCase()) return null;
    return final;
}
