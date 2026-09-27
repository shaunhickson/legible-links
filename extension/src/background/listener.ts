/**
 * The worker's message boundary. Only our own content scripts on http(s)
 * pages are answered, and the page host comes from the sender, never from
 * the message.
 */
import { isResolveRequest, ResolveResponse } from '../shared/protocol';
import { Router } from './router';

export interface MessageSender {
    id?: string;
    url?: string;
}

export type SendResponse = (response: ResolveResponse) => void;
export type MessageHandler = (message: unknown, sender: MessageSender, sendResponse: SendResponse) => true | undefined;

export function pageHostFromSender(url: string | undefined): string | null {
    if (!url) return null;
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname || null;
}

/** Returns true (keep the channel open) only for a request it will answer. */
export function createMessageHandler(router: Router, selfId: string): MessageHandler {
    return (message, sender, sendResponse) => {
        if (!selfId || sender.id !== selfId) return undefined;
        const pageHost = pageHostFromSender(sender.url);
        if (!pageHost) return undefined;
        if (!isResolveRequest(message)) return undefined;

        router.resolve(message.urls, message.trigger, pageHost).then(
            (results) => sendResponse({ results }),
            () => sendResponse({ results: {} }), // fail open
        );
        return true;
    };
}
