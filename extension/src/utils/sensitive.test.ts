import { describe, it, expect, afterEach } from 'vitest';
import { classifyUrl, hasHighEntropySegment, isEditableContext, isSensitivePageHost, stripForTransmission, textDomainMatchesHref } from './sensitive';

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

describe('stripForTransmission', () => {
    it.each<[string, string, string]>([
        ['https://example.com/page#section-2', 'https://example.com/page', 'fragment'],
        ['https://example.com/?utm_source=x&utm_medium=email&utm_campaign=c', 'https://example.com/', 'utm_* only'],
        ['https://example.com/read?utm_source=nl&id=7&fbclid=IwAR0', 'https://example.com/read?id=7', 'keeps other params in place'],
        ['https://example.com/?a=1&gclid=x&b=2', 'https://example.com/?a=1&b=2', 'order preserved'],
        ['https://example.com/?UTM_Source=x&Si=abc', 'https://example.com/', 'names are case-insensitive'],
        ['https://example.com/?q=a%20b&utm_term=t', 'https://example.com/?q=a%20b', 'surviving encoding untouched'],
        ['https://example.com/?q=hello+world', 'https://example.com/?q=hello+world', 'plus signs untouched'],
        ['https://youtu.be/dQw4w9WgXcQ?si=Ab12&feature=share', 'https://youtu.be/dQw4w9WgXcQ', 'si and feature'],
        ['https://example.com/?ref_src=twsrc&ref_url=x&_hsenc=1&_hsmi=2&vero_id=3&yclid=4&twclid=5&ttclid=6&gbraid=7&wbraid=8&mc_cid=9&mc_eid=10&igshid=11&dclid=12&msclkid=13', 'https://example.com/', 'the whole list'],
        ['https://example.com/?utm', 'https://example.com/?utm', 'utm without underscore is kept'],
        ['https://example.com/?flag', 'https://example.com/?flag', 'valueless param kept'],
        ['https://example.com/a?x=1#y', 'https://example.com/a?x=1', 'fragment after query'],
        ['not a url', 'not a url', 'unparseable input is returned as-is'],
    ])('%s -> %s (%s)', (href, expected) => {
        expect(stripForTransmission(href)).toBe(expected);
    });
});

describe('isSensitivePageHost', () => {
    it.each<[string, boolean]>([
        ['mail.google.com', true],
        ['MAIL.GOOGLE.COM', true],
        ['outlook.live.com', true],
        ['outlook.office.com', true],
        ['outlook.office365.com', true],
        ['outlook.com', true],
        ['mail.yahoo.com', true],
        ['mail.proton.me', true],
        ['app.slack.com', true],
        ['acme.slack.com', true],
        ['discord.com', true],
        ['teams.microsoft.com', true],
        ['web.whatsapp.com', true],
        ['web.telegram.org', true],
        ['www.messenger.com', true],
        ['docs.google.com', true],
        ['drive.google.com', true],
        ['www.notion.so', true],
        ['acme.notion.site', true],
        ['acme.atlassian.net', true],
        ['acme.zendesk.com', true],
        ['acme.freshdesk.com', true],
        ['app.intercom.io', true],
        ['news.ycombinator.com', false],
        ['www.google.com', false],
        ['slack.com', false],
        ['notoutlook.example', false],
        ['example.com', false],
        ['', false],
    ])('%s -> %s', (host, expected) => {
        expect(isSensitivePageHost(host)).toBe(expected);
    });
});

describe('hasHighEntropySegment', () => {
    it.each<[string, boolean, string]>([
        ['https://example.com/blog/2026/09/the-10-best-laptops-of-2026', false, 'hyphenated slug with a year'],
        ['https://example.com/questions/11227809/why-is-processing-a-sorted-array-faster', false, 'numeric id plus slug'],
        ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', false, '11-char id is below the bar'],
        ['https://example.com/share/4f9c2a1b7e3d4c5a9b8f7e6d5c4b3a2f', true, '32 hex chars'],
        ['https://example.com/f/123e4567-e89b-12d3-a456-426614174000', true, 'UUID'],
        ['https://docs.example.com/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit', true, 'document id'],
        ['https://example.com/?token=abcdefghij1234567890', true, 'mixed 20-char query value'],
        ['https://example.com/?q=abcdefghijklmnopqrstuvwxyz', false, 'letters only'],
        ['https://example.com/?n=12345678901234567890123', false, 'digits only'],
        ['https://example.com/a1b2c3d4e5f6g7h8i9j', false, '19 chars is below the bar'],
        ['https://example.com/a1b2c3d4e5f6g7h8i9j0', true, '20 chars mixing letters and digits'],
        ['https://example.com/x-a1b2c3d4e5f6g7h8i9j0-y', true, 'run inside a hyphenated segment'],
        ['https://example.com/abc%20def', false, 'percent-encoded space'],
        ['not a url', false, 'unparseable'],
    ])('%s -> %s (%s)', (href, expected) => {
        expect(hasHighEntropySegment(href)).toBe(expected);
    });
});
