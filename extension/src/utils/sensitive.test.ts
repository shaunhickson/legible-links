import { describe, it, expect, afterEach } from 'vitest';
import { classifyUrl, textDomainMatchesHref, isEditableContext } from './sensitive';

describe('classifyUrl', () => {
    it.each<[string, 'ok' | 'skip', string]>([
        // plain public URLs
        ['https://example.com/', 'ok', 'plain https'],
        ['http://example.com/article', 'ok', 'plain http'],
        ['https://example.com/?utm_source=x', 'ok', 'tracking param is not sensitive'],
        ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'ok', 'youtube watch'],
        ['https://example.com:443/', 'ok', 'default https port'],
        ['http://example.com:80/', 'ok', 'default http port'],
        ['https://example.com/settings/account', 'ok', 'non-sensitive path'],
        ['https://example.com/login-help', 'ok', 'segment only partially matches'],
        // unparseable / wrong scheme
        ['not a url', 'skip', 'unparseable'],
        ['javascript:alert(1)', 'skip', 'javascript scheme'],
        ['mailto:someone@example.com', 'skip', 'mailto'],
        ['ftp://example.com/file', 'skip', 'ftp'],
        ['data:text/html,hi', 'skip', 'data'],
        // credentials
        ['https://user:pw@example.com/', 'skip', 'username and password'],
        ['https://user@example.com/', 'skip', 'username only'],
        // hosts
        ['http://192.168.1.1/admin', 'skip', 'IPv4 literal'],
        ['http://2130706433/', 'skip', 'IPv4 as integer'],
        ['http://[::1]/', 'skip', 'IPv6 literal'],
        ['http://[2001:db8::1]/', 'skip', 'public IPv6 literal'],
        ['http://localhost/', 'skip', 'localhost'],
        ['https://intranet/wiki', 'skip', 'single-label host'],
        ['https://app.localhost/', 'skip', '.localhost'],
        ['https://foo.local/', 'skip', '.local'],
        ['https://build.internal/', 'skip', '.internal'],
        ['https://abc.onion/', 'skip', '.onion'],
        ['https://nas.home.arpa/', 'skip', '.home.arpa'],
        ['https://wiki.corp/', 'skip', '.corp'],
        ['https://printer.lan/', 'skip', '.lan'],
        ['https://portal.intranet/', 'skip', '.intranet'],
        ['https://foo.test/', 'skip', '.test'],
        ['https://foo.example/', 'skip', '.example'],
        ['https://foo.invalid/', 'skip', '.invalid'],
        // ports
        ['https://example.com:8443/', 'skip', 'non-standard port'],
        ['http://example.com:3000/', 'skip', 'dev server port'],
        // query parameter names
        ['https://accounts.example.com/reset?token=abc', 'skip', 'token param'],
        ['https://example.com/?access_token=abc', 'skip', 'access_token normalizes to accesstoken'],
        ['https://example.com/?Access-Token=abc', 'skip', 'case and dashes ignored'],
        ['https://example.com/?refresh_token=abc', 'skip', 'refresh_token'],
        ['https://example.com/?id_token=abc', 'skip', 'id_token'],
        ['https://example.com/?key=abc', 'skip', 'key'],
        ['https://example.com/?apikey=abc', 'skip', 'apikey'],
        ['https://example.com/?api_key=abc', 'skip', 'api_key'],
        ['https://example.com/?sig=abc', 'skip', 'sig'],
        ['https://example.com/?signature=abc', 'skip', 'signature'],
        ['https://example.com/?code=abc', 'skip', 'code'],
        ['https://example.com/?otp=123456', 'skip', 'otp'],
        ['https://example.com/?secret=abc', 'skip', 'secret'],
        ['https://example.com/?password=abc', 'skip', 'password'],
        ['https://example.com/?passwd=abc', 'skip', 'passwd'],
        ['https://example.com/?pwd=abc', 'skip', 'pwd'],
        ['https://example.com/?session=abc', 'skip', 'session'],
        ['https://example.com/?sessionid=abc', 'skip', 'sessionid'],
        ['https://example.com/?sid=abc', 'skip', 'sid'],
        ['https://example.com/?reset=1', 'skip', 'reset'],
        ['https://example.com/?verify=1', 'skip', 'verify'],
        ['https://example.com/?confirm=1', 'skip', 'confirm'],
        ['https://example.com/?unsubscribe=1', 'skip', 'unsubscribe'],
        ['https://example.com/?invite=abc', 'skip', 'invite'],
        ['https://example.com/?magic=abc', 'skip', 'magic'],
        ['https://example.com/?jwt=abc', 'skip', 'jwt'],
        ['https://example.com/?auth=abc', 'skip', 'auth'],
        ['https://example.com/?authorization=abc', 'skip', 'authorization'],
        ['https://bucket.s3.amazonaws.com/f?X-Amz-Signature=abc', 'skip', 'X-Amz-Signature'],
        ['https://bucket.s3.amazonaws.com/f?X-Amz-Credential=abc', 'skip', 'X-Amz-Credential'],
        ['https://example.com/?page=2&token=abc', 'skip', 'sensitive param among others'],
        // path segments
        ['https://example.com/reset', 'skip', '/reset'],
        ['https://example.com/reset-password/abc', 'skip', '/reset-password'],
        ['https://example.com/account/verify/abc', 'skip', '/verify'],
        ['https://example.com/verify-email/abc', 'skip', '/verify-email'],
        ['https://example.com/confirm/abc', 'skip', '/confirm'],
        ['https://example.com/unsubscribe/abc', 'skip', '/unsubscribe'],
        ['https://example.com/invite/abc', 'skip', '/invite'],
        ['https://example.com/invitation/abc', 'skip', '/invitation'],
        ['https://example.com/magic/abc', 'skip', '/magic'],
        ['https://example.com/magic-link/abc', 'skip', '/magic-link'],
        ['https://example.com/auth/abc', 'skip', '/auth'],
        ['https://example.com/oauth/callback', 'skip', '/oauth/callback'],
        ['https://example.com/api/callback', 'skip', '/callback'],
        ['https://example.com/signin', 'skip', '/signin'],
        ['https://example.com/sign-in', 'skip', '/sign-in'],
        ['https://example.com/login', 'skip', '/login'],
        ['https://example.com/activate/abc', 'skip', '/activate'],
        ['https://example.com/activation/abc', 'skip', '/activation'],
        ['https://example.com/sso', 'skip', '/sso'],
        ['https://example.com/LOGIN', 'skip', 'segment match is case-insensitive'],
        ['https://example.com/%6Cogin', 'skip', 'percent-encoded segment is decoded'],
    ])('%s -> %s (%s)', (href, expected) => {
        expect(classifyUrl(href)).toBe(expected);
    });
});

describe('textDomainMatchesHref', () => {
    it('rejects text naming a different host than the href', () => {
        expect(textDomainMatchesHref('paypal.com', 'https://evil.example.com/login')).toBe(false);
        expect(textDomainMatchesHref('https://paypal.com/account', 'https://evil.example.com/')).toBe(false);
        expect(textDomainMatchesHref('https://www.paypal.com', 'https://paypal.com.evil.example/')).toBe(false);
    });

    it('accepts matching hosts, ignoring www and known aliases', () => {
        expect(textDomainMatchesHref('https://youtu.be/abc', 'https://www.youtube.com/watch?v=abc')).toBe(true);
        expect(textDomainMatchesHref('youtu.be/abc', 'https://www.youtube.com/watch?v=abc')).toBe(true);
        expect(textDomainMatchesHref('x.com/foo', 'https://twitter.com/foo')).toBe(true);
        expect(textDomainMatchesHref('https://twitter.com/foo', 'https://x.com/foo')).toBe(true);
        expect(textDomainMatchesHref('example.com', 'https://www.example.com/')).toBe(true);
        expect(textDomainMatchesHref('EXAMPLE.com/Path', 'https://example.com/Path')).toBe(true);
    });

    it('treats subdomains as different hosts', () => {
        expect(textDomainMatchesHref('example.com', 'https://docs.example.com/')).toBe(false);
    });

    it('passes when the text has no parseable host', () => {
        expect(textDomainMatchesHref('Click here', 'https://example.com/')).toBe(true);
        expect(textDomainMatchesHref('hello', 'https://example.com/')).toBe(true);
        expect(textDomainMatchesHref('', 'https://example.com/')).toBe(true);
    });

    it('fails when the href itself is unparseable', () => {
        expect(textDomainMatchesHref('example.com', 'nope')).toBe(false);
    });
});

describe('isEditableContext', () => {
    afterEach(() => {
        document.body.replaceChildren();
        document.designMode = 'off';
    });

    function anchorInside(parent: Element): HTMLAnchorElement {
        const a = document.createElement('a');
        a.setAttribute('href', 'https://example.com/');
        a.textContent = 'https://example.com/';
        parent.appendChild(a);
        document.body.appendChild(parent);
        return a;
    }

    it('is true inside a contenteditable div', () => {
        const div = document.createElement('div');
        div.setAttribute('contenteditable', 'true');
        expect(isEditableContext(anchorInside(div))).toBe(true);
    });

    it('is true for contenteditable="" and plaintext-only and mixed case', () => {
        for (const value of ['', 'plaintext-only', 'TRUE']) {
            const div = document.createElement('div');
            div.setAttribute('contenteditable', value);
            expect(isEditableContext(anchorInside(div)), value).toBe(true);
        }
    });

    it('is true when nested several levels below the editable ancestor', () => {
        const editor = document.createElement('div');
        editor.setAttribute('contenteditable', 'true');
        const p = document.createElement('p');
        const span = document.createElement('span');
        const a = document.createElement('a');
        span.appendChild(a);
        p.appendChild(span);
        editor.appendChild(p);
        document.body.appendChild(editor);
        expect(isEditableContext(a)).toBe(true);
    });

    it('is true inside role=textbox and role=combobox', () => {
        const box = document.createElement('div');
        box.setAttribute('role', 'textbox');
        expect(isEditableContext(anchorInside(box))).toBe(true);
        const combo = document.createElement('div');
        combo.setAttribute('role', 'combobox');
        expect(isEditableContext(anchorInside(combo))).toBe(true);
    });

    it('is false for a plain anchor', () => {
        const div = document.createElement('div');
        expect(isEditableContext(anchorInside(div))).toBe(false);
    });

    it('is false for contenteditable="false"', () => {
        const div = document.createElement('div');
        div.setAttribute('contenteditable', 'false');
        expect(isEditableContext(anchorInside(div))).toBe(false);
    });

    it('looks through shadow roots to the host ancestry', () => {
        const editor = document.createElement('div');
        editor.setAttribute('contenteditable', 'true');
        const host = document.createElement('div');
        editor.appendChild(host);
        document.body.appendChild(editor);
        const shadow = host.attachShadow({ mode: 'open' });
        const a = document.createElement('a');
        shadow.appendChild(a);
        expect(isEditableContext(a)).toBe(true);
    });

    it('is true when the document is in design mode', () => {
        const div = document.createElement('div');
        const a = anchorInside(div);
        document.designMode = 'on';
        expect(isEditableContext(a)).toBe(true);
    });
});
