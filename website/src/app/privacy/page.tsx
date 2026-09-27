import React from 'react';
import { Eye, Shield } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy Policy', description: 'What leaves your browser, where it goes, and what our server keeps: nothing.' };

const ISSUES = 'https://github.com/shaunhickson/legible-links/issues';
const CONTRACT = 'https://github.com/shaunhickson/legible-links/blob/main/extension/src/privacy-contract.test.ts';

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">{children}</h2>;
}

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans selection:bg-blue-100 selection:text-blue-900">
      <header className="max-w-4xl mx-auto px-6 py-8 flex items-center gap-2 font-bold text-2xl text-slate-900 dark:text-white">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Eye className="text-blue-600" size={32} />
          Legible Links
        </Link>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 text-slate-800 dark:text-slate-200 leading-relaxed">
        <div className="bg-white dark:bg-slate-900 p-8 md:p-12 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-4 mb-8 text-blue-600">
            <Shield size={40} />
            <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">Privacy Policy</h1>
          </div>
          <p className="mb-8 text-sm text-slate-500">Last updated: 27 September 2026</p>

          <div className="space-y-10">
            <section>
              <H2>In short</H2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Legible Links has no accounts, no analytics, no telemetry and no cookies. Nothing about you is collected or sold.</li>
                <li>Most links are handled entirely inside your browser. By default, our server is contacted only when you hover a link, and it keeps no record of links or of who asked.</li>
                <li>Everything this page claims is enforced by an automated test in the source code. You can <a href={CONTRACT} className="text-blue-600 hover:underline">read it</a>.</li>
              </ul>
            </section>

            <section>
              <H2>1. What the extension does</H2>
              <p>
                Legible Links looks at the links on the pages you visit. When a link&apos;s visible text is just a raw web address, it replaces that text with the page&apos;s title and the domain the link points to. It never changes where a link goes, and it never touches links inside anything you are typing.
              </p>
            </section>

            <section>
              <H2>2. Where a link&apos;s title comes from</H2>
              <p className="mb-4">There are three ways a title is found. Which one applies depends only on the link.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2 pr-4">Links to</th>
                      <th className="py-2 pr-4">How</th>
                      <th className="py-2">Who receives what</th>
                    </tr>
                  </thead>
                  <tbody className="align-top">
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-3 pr-4 font-medium">Wikipedia, GitHub, Reddit, Stack Overflow, Amazon</td>
                      <td className="py-3 pr-4">The title is read from the address itself.</td>
                      <td className="py-3">Nobody. No network request is made.</td>
                    </tr>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-3 pr-4 font-medium">YouTube, Spotify, X, Reddit, Vimeo</td>
                      <td className="py-3 pr-4">Your browser asks that platform&apos;s public embed service for the title of that one item.</td>
                      <td className="py-3">The platform receives the item&apos;s ID and, as with any web request, your IP address and browser type. No cookies are sent, so the request is not tied to any account you have there.</td>
                    </tr>
                    <tr>
                      <td className="py-3 pr-4 font-medium">Everything else, and shortened links (bit.ly, t.co, ...)</td>
                      <td className="py-3 pr-4">Your browser sends the address to the Legible Links server, which fetches the page&apos;s title on your behalf. By default this happens only when you hover the link.</td>
                      <td className="py-3">Our server receives the link address (with tracking parameters and fragments removed) and your IP address for the duration of the request. It does not receive the address of the page you are reading, cookies, or any identifier. The linked site sees our server, not you.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <H2>3. What is never sent anywhere</H2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Links to private or local addresses: IP addresses, single-word hosts, <code>localhost</code>, <code>.local</code>, <code>.internal</code>, <code>.onion</code> and similar, or non-standard ports.</li>
                <li>Links that look single-use or authenticated: addresses containing tokens, keys, signatures, session IDs, one-time codes, or paths such as reset, verify, confirm, unsubscribe, invite, login, sign-in or OAuth callbacks, and addresses with a long random-looking segment.</li>
                <li>Links whose visible text names one site while the address goes to another. These are left alone rather than given a friendly title.</li>
                <li>Anything inside a text box, editor or composer.</li>
                <li>On webmail, chat and document sites, automatic server lookups are switched off; hovering still works.</li>
              </ul>
            </section>

            <section>
              <H2>4. Your choice of mode</H2>
              <p className="mb-4">The options page offers three settings. The default is Balanced.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2 pr-4">Mode</th>
                      <th className="py-2 pr-4">From the address</th>
                      <th className="py-2 pr-4">From the platform</th>
                      <th className="py-2">From our server</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-100 dark:border-slate-800"><td className="py-2 pr-4 font-medium">Private</td><td className="py-2 pr-4">automatic</td><td className="py-2 pr-4">on hover</td><td className="py-2">never</td></tr>
                    <tr className="border-b border-slate-100 dark:border-slate-800"><td className="py-2 pr-4 font-medium">Balanced</td><td className="py-2 pr-4">automatic</td><td className="py-2 pr-4">automatic</td><td className="py-2">on hover</td></tr>
                    <tr><td className="py-2 pr-4 font-medium">Everything</td><td className="py-2 pr-4">automatic</td><td className="py-2 pr-4">automatic</td><td className="py-2">automatic</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-4">You can also turn the extension off for particular sites, or point it at a server you run yourself, in which case our server receives nothing at all.</p>
            </section>

            <section>
              <H2>5. What our server keeps</H2>
              <ul className="list-disc pl-6 space-y-2">
                <li>No database and no files. It holds a short-lived in-memory cache of address-to-title pairs (at most 24 hours, and lost whenever it restarts) so the same public page is not fetched twice.</li>
                <li>Its logs record only the request method, path, status code and duration. They never contain link addresses, query strings, IP addresses or browser identifiers. The hosting provider&apos;s per-request logs, which would contain IP addresses, are switched off.</li>
                <li>It needs no API keys and holds no credentials for any service.</li>
                <li>When it fetches a page on your behalf it identifies itself as <code>LegibleLinks</code> with a link to the project, so site owners can recognise or block it.</li>
              </ul>
              <p className="mt-4">The server&apos;s source is public and you can run the same image yourself with one command; see the self-hosting guide in the repository.</p>
            </section>

            <section>
              <H2>6. What stays in your browser</H2>
              <p>
                Your settings are stored in the extension&apos;s local storage on your device and are never synced or sent anywhere. Resolved titles are cached in session storage, which the browser clears when it closes.
              </p>
            </section>

            <section>
              <H2>7. Permissions the extension asks for</H2>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Read and change data on all websites.</strong> Needed to find raw links on any page and replace their text. This is the only broad permission, and section 3 describes the limits on what it is used for.</li>
                <li><strong>Storage.</strong> Your settings and the session cache.</li>
                <li><strong>Specific hosts:</strong> the five platform embed services listed in section 2 and the Legible Links server.</li>
              </ul>
              <p className="mt-4">
                In store listings this is declared as handling &quot;website content&quot;, because link addresses found on pages you visit may be sent to a platform or to our server as described above. Nothing is sold, shared, or used for any other purpose.
              </p>
            </section>

            <section>
              <H2>8. Changes and contact</H2>
              <p>
                This policy lives in the project&apos;s repository, so every change is recorded in its history. Questions or concerns: <a href={ISSUES} className="text-blue-600 hover:underline">open an issue on GitHub</a>.
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
