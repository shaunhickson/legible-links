import React from 'react';
import { Eye, Shield } from 'lucide-react';
import Link from 'next/link';

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
          <p className="mb-6 text-sm text-slate-500">Last Updated: April 2026</p>

          <div className="space-y-8">
            <section>
              <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">1. Our Philosophy</h2>
              <p>
                Legible Links is built on a foundation of trust. Our goal is to make the web more transparent without compromising your privacy. We process URLs to resolve their titles, but we do not track you, we do not log your browsing history, and we do not sell your data.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">2. Data Collection</h2>
              <p className="mb-4">
                The Legible Links browser extension only interacts with URLs that you encounter. When a supported opaque URL is found:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>The &quot;raw&quot; URL is sent to our backend resolution service.</li>
                <li>No personally identifiable information (PII) is attached to this request.</li>
                <li>We do not send cookies, user IDs, or local browser state to our servers.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">3. Data Storage & Logging</h2>
              <p>
                Our backend caches the mapping of public URLs to their public titles. We do not store the IP address of the user who requested the resolution, nor do we build profiles of what links any specific user is viewing.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">4. Third Parties</h2>
              <p>
                We do not sell, rent, or trade any data to third parties. Our infrastructure runs on secure hosting providers designed to prioritize data protection.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">5. Contact Us</h2>
              <p>
                If you have questions about this Privacy Policy, please <a href="https://github.com/shaunhickson/legible-links/issues" className="text-blue-600 hover:underline">open an issue on GitHub</a>.
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
