'use client';

import React, { useState } from 'react';
import { Search, Loader2, Youtube, Github, Link as LinkIcon, AlertCircle } from 'lucide-react';

export const LiveDemo: React.FC = () => {
    const [url, setUrl] = useState('');
    const [result, setResult] = useState<{ title: string; platform: string; description?: string } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleResolve = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!url) return;

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const response = await fetch('https://youtube-replacer-backend-542312799814.us-east1.run.app/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: [url] })
            });

            if (!response.ok) throw new Error('Failed to resolve URL');

            const data = await response.json();
            const titles = data.titles || {};
            const details = data.details || {};

            if (titles[url]) {
                setResult({
                    title: titles[url],
                    platform: details[url]?.platform || 'generic',
                    description: details[url]?.description
                });
            } else {
                setError('No resolution found for this URL.');
            }
        } catch (err) {
            console.error(err);
            setError('Error connecting to Legible Links API.');
        } finally {
            setLoading(false);
        }
    };

    const getPlatformIcon = (platform: string) => {
        switch (platform) {
            case 'youtube': return <Youtube size={18} />;
            case 'github': return <Github size={18} />;
            default: return <LinkIcon size={18} />;
        }
    };

    return (
        <div className="w-full max-w-2xl mx-auto p-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl">
            <h3 className="text-xl font-bold mb-6 text-slate-900 dark:text-white text-center">Try it yourself</h3>
            
            <form onSubmit={handleResolve} className="flex flex-col sm:flex-row gap-3 mb-8">
                <input
                    type="text"
                    placeholder="Paste a URL (YouTube, GitHub, Bitly...)"
                    className="flex-1 px-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                />
                <button
                    type="submit"
                    disabled={loading || !url}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors min-w-[120px]"
                >
                    {loading ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
                    {loading ? 'Solving...' : 'Resolve'}
                </button>
            </form>

            <div className="min-h-[100px] flex items-center justify-center border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-xl p-6 bg-slate-50/50 dark:bg-slate-950/50">
                {!loading && !result && !error && (
                    <p className="text-slate-400 text-sm">Output will appear here</p>
                )}

                {error && (
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-medium">
                        <AlertCircle size={20} />
                        {error}
                    </div>
                )}

                {result && (
                    <div className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-bold text-lg mb-2">
                            {getPlatformIcon(result.platform)}
                            {result.title}
                        </div>
                        {result.description && (
                            <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed italic">
                                {result.description}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
