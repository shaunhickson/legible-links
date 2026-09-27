import React from 'react';
import Link from 'next/link';
import { Youtube, Github, Link as LinkIcon, Shield, Eye, Download, Code, BookOpen, Server, Laptop } from 'lucide-react';
import { LinkExample } from '@/components/LinkExample';

const REPO = 'https://github.com/shaunhickson/legible-links';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans selection:bg-blue-100 selection:text-blue-900">
      <header className="max-w-6xl mx-auto px-6 py-8 flex justify-between items-center">
        <div className="flex items-center gap-2 font-bold text-2xl text-slate-900 dark:text-white">
          <Eye className="text-blue-600" size={32} />
          Legible Links
        </div>
        <div className="flex gap-6 items-center">
          <a href={REPO} className="text-slate-600 dark:text-slate-400 hover:text-blue-600 transition-colors hidden sm:flex items-center gap-2 text-sm font-medium">
            <Github size={18} /> GitHub
          </a>
          <a href="#install" className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-2 rounded-full text-sm font-bold hover:opacity-90 transition-opacity flex items-center gap-2">
            <Download size={18} /> Install
          </a>
        </div>
      </header>

      <main>
        <section className="max-w-4xl mx-auto px-6 pt-20 pb-24 text-center">
          <h1 className="text-5xl md:text-7xl font-extrabold text-slate-900 dark:text-white mb-8 tracking-tight">
            See where a link goes <span className="text-blue-600">before you click.</span>
          </h1>
          <p className="text-xl text-slate-600 dark:text-slate-400 mb-12 max-w-2xl mx-auto leading-relaxed">
            Legible Links is a browser extension that turns raw URLs in link text into readable titles, and always shows the destination next to them. The link itself is never changed.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <a href="#install" className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl text-lg font-bold transition-all shadow-lg shadow-blue-500/20">
              Get the extension
            </a>
            <Link href="/privacy" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white px-8 py-4 rounded-xl text-lg font-bold hover:bg-slate-50 transition-all flex items-center justify-center gap-2">
              <Shield size={20} /> Read the privacy policy
            </Link>
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900/50 py-24 border-y border-slate-200 dark:border-slate-800">
          <div className="max-w-5xl mx-auto px-6">
            <h2 className="text-3xl font-bold text-center mb-4 dark:text-white">What you see instead</h2>
            <p className="text-center text-slate-600 dark:text-slate-400 mb-16">The title, then the domain the link actually points to.</p>
            <div className="space-y-6">
              <LinkExample
                before="https://youtu.be/dQw4w9WgXcQ"
                after="Rick Astley - Never Gonna Give You Up (Official Video)"
                domain="youtube.com"
                platformIcon={<Youtube size={20} />}
              />
              <LinkExample
                before="https://en.wikipedia.org/wiki/Rick_Astley"
                after="Rick Astley"
                domain="en.wikipedia.org"
                platformIcon={<BookOpen size={20} />}
              />
              <LinkExample
                before="https://bit.ly/3abc"
                after="Rick Astley - Never Gonna Give You Up (Official Video)"
                domain="youtube.com via bit.ly"
                platformIcon={<LinkIcon size={20} />}
              />
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 py-24">
          <h2 className="text-3xl font-bold text-center mb-4 dark:text-white">How a title is found</h2>
          <p className="text-center text-slate-600 dark:text-slate-400 mb-16 max-w-2xl mx-auto">
            Most links never leave your browser. The rest go only where you would expect, and only when you ask.
          </p>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 w-12 h-12 rounded-xl flex items-center justify-center mb-6">
                <Laptop size={24} />
              </div>
              <h3 className="text-lg font-bold mb-3 dark:text-white">In your browser, no network</h3>
              <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
                Wikipedia, GitHub, Reddit, Stack Overflow and Amazon put the title in the URL itself. Legible Links reads it from there. Nothing is sent anywhere.
              </p>
            </div>
            <div className="p-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 w-12 h-12 rounded-xl flex items-center justify-center mb-6">
                <Youtube size={24} />
              </div>
              <h3 className="text-lg font-bold mb-3 dark:text-white">Straight from the platform</h3>
              <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
                YouTube, Spotify, X, Reddit and Vimeo links are looked up with the platform&apos;s own public embed service, without cookies. The platform sees the item ID, the same as if you previewed it.
              </p>
            </div>
            <div className="p-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 w-12 h-12 rounded-xl flex items-center justify-center mb-6">
                <Server size={24} />
              </div>
              <h3 className="text-lg font-bold mb-3 dark:text-white">Everything else, on hover</h3>
              <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
                Other pages and shortened links are resolved by a small server that keeps no data and no logs of links or addresses. By default it is contacted only when you hover a link. You can run your own.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900/50 py-24 border-y border-slate-200 dark:border-slate-800">
          <div className="max-w-5xl mx-auto px-6">
            <h2 className="text-3xl font-bold text-center mb-16 dark:text-white">Built to be trusted</h2>
            <div className="grid md:grid-cols-3 gap-12 text-center">
              <div>
                <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Shield size={32} />
                </div>
                <h3 className="text-xl font-bold mb-4 dark:text-white">Nothing sensitive leaves</h3>
                <p className="text-slate-600 dark:text-slate-400">
                  Links that look like password resets, sign-ins, invites or private servers are never sent anywhere. Links inside anything you are typing are never touched.
                </p>
              </div>
              <div>
                <div className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Eye size={32} />
                </div>
                <h3 className="text-xl font-bold mb-4 dark:text-white">The URL is never hidden</h3>
                <p className="text-slate-600 dark:text-slate-400">
                  The destination domain sits next to every title, and the full address is one hover away. A title can never impersonate another site.
                </p>
              </div>
              <div>
                <div className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Code size={32} />
                </div>
                <h3 className="text-xl font-bold mb-4 dark:text-white">Open source</h3>
                <p className="text-slate-600 dark:text-slate-400">
                  MIT licensed. The test suite that defines what may leave your browser is part of the code, so you can check every claim on this page.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="install" className="max-w-3xl mx-auto px-6 py-24 text-center">
          <h2 className="text-3xl font-bold mb-6 dark:text-white">Install</h2>
          <p className="text-slate-600 dark:text-slate-400 mb-8 leading-relaxed">
            Legible Links is being prepared for the Chrome Web Store and Firefox Add-ons. Until the listings are live, you can build it from source and load it as an unpacked extension; the README explains how.
          </p>
          <a href={REPO} className="inline-flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-6 py-3 rounded-xl font-bold hover:opacity-90 transition-opacity">
            <Github size={20} /> Get it from GitHub
          </a>
        </section>
      </main>

      <footer className="max-w-6xl mx-auto px-6 py-12 border-t border-slate-200 dark:border-slate-800 flex flex-col md:flex-row justify-between items-center gap-8 text-slate-500 text-sm">
        <div>Legible Links is free, open source and has no business model.</div>
        <div className="flex gap-8">
          <Link href="/privacy" className="hover:text-blue-600 transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-blue-600 transition-colors">Terms</Link>
          <a href={REPO} className="hover:text-blue-600 transition-colors flex items-center gap-1">
            <Github size={14} /> Source
          </a>
        </div>
      </footer>
    </div>
  );
}
