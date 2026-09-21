import React from 'react';
import { Youtube, Github, Link as LinkIcon, Shield, Zap, Eye, Download, Code } from 'lucide-react';
import { LinkExample } from '@/components/LinkExample';
import { LiveDemo } from '@/components/LiveDemo';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Header */}
      <header className="max-w-6xl mx-auto px-6 py-8 flex justify-between items-center">
        <div className="flex items-center gap-2 font-bold text-2xl text-slate-900 dark:text-white">
          <Eye className="text-blue-600" size={32} />
          Legible Links
        </div>
        <div className="flex gap-6 items-center">
          <a href="https://github.com/shaunhickson/legible-links" className="text-slate-600 dark:text-slate-400 hover:text-blue-600 transition-colors hidden sm:flex items-center gap-2 text-sm font-medium">
            <Github size={18} /> GitHub
          </a>
          <a href="#" className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-2 rounded-full text-sm font-bold hover:opacity-90 transition-opacity flex items-center gap-2">
            <Download size={18} /> Install
          </a>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="max-w-4xl mx-auto px-6 pt-20 pb-32 text-center">
          <h1 className="text-5xl md:text-7xl font-extrabold text-slate-900 dark:text-white mb-8 tracking-tight">
            Transparency for the <span className="text-blue-600">Web.</span>
          </h1>
          <p className="text-xl text-slate-600 dark:text-slate-400 mb-12 max-w-2xl mx-auto leading-relaxed">
            Stop &quot;clicking and hoping.&quot; Legible Links reveals what&apos;s behind opaque URLs instantly, bringing clarity and safety to your browsing experience.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <button className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl text-lg font-bold transition-all shadow-lg shadow-blue-500/20">
              Get Started for Free
            </button>
            <button className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white px-8 py-4 rounded-xl text-lg font-bold hover:bg-slate-50 transition-all flex items-center justify-center gap-2">
              <Code size={20} /> View Source
            </button>
          </div>
        </section>

        {/* Examples Section */}
        <section className="bg-white dark:bg-slate-900/50 py-24 border-y border-slate-200 dark:border-slate-800">
          <div className="max-w-5xl mx-auto px-6">
            <h2 className="text-3xl font-bold text-center mb-16 dark:text-white">The Lens in Action</h2>
            <div className="space-y-6">
              <LinkExample 
                before="https://www.youtube.com/watch?v=dQw4w9WgXcQ" 
                after="Rick Astley - Never Gonna Give You Up (Official Music Video)" 
                platformIcon={<Youtube size={20} />} 
              />
              <LinkExample 
                before="https://github.com/google/go" 
                after="google/go (The Go programming language ★ 120k)" 
                platformIcon={<Github size={20} />} 
              />
              <LinkExample 
                before="https://bit.ly/3x86n7r" 
                after="Google" 
                platformIcon={<LinkIcon size={20} />} 
              />
            </div>
          </div>
        </section>

        {/* Live Demo Section */}
        <section className="py-32 bg-slate-50 dark:bg-slate-950">
          <div className="max-w-6xl mx-auto px-6">
            <LiveDemo />
          </div>
        </section>

        {/* Pillars Section */}
        <section className="max-w-6xl mx-auto px-6 py-32 grid md:grid-cols-3 gap-12 text-center">
          <div>
            <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Shield size={32} />
            </div>
            <h3 className="text-xl font-bold mb-4 dark:text-white">Privacy First</h3>
            <p className="text-slate-600 dark:text-slate-400">
              We resolve links, we don&apos;t track you. No cookies, no history logging, and strictly isolated browser logic.
            </p>
          </div>
          <div>
            <div className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Zap size={32} />
            </div>
            <h3 className="text-xl font-bold mb-4 dark:text-white">Lightning Fast</h3>
            <p className="text-slate-600 dark:text-slate-400">
              Built with Go and optimized for performance. Resolution happens in milliseconds, ensuring zero lag.
            </p>
          </div>
          <div>
            <div className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Code size={32} />
            </div>
            <h3 className="text-xl font-bold mb-4 dark:text-white">Open Source</h3>
            <p className="text-slate-600 dark:text-slate-400">
              Transparent code for a transparent web. Auditable, customizable, and community-driven.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-12 border-t border-slate-200 dark:border-slate-800 flex flex-col md:flex-row justify-between items-center gap-8 text-slate-500 text-sm">
        <div>© 2026 Legible Links. Built for a better web.</div>
        <div className="flex gap-8">
          <a href="/privacy" className="hover:text-blue-600 transition-colors">Privacy Policy</a>
          <a href="/terms" className="hover:text-blue-600 transition-colors">Terms of Service</a>
          <a href="https://github.com/shaunhickson/legible-links" className="hover:text-blue-600 transition-colors flex items-center gap-1">
            <Github size={14} /> Open Source
          </a>
        </div>
      </footer>
    </div>
  );
}
