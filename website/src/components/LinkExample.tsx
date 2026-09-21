import React from 'react';
import { ArrowRight } from 'lucide-react';

interface LinkExampleProps {
    before: string;
    after: string;
    platformIcon: React.ReactNode;
}

export const LinkExample: React.FC<LinkExampleProps> = ({ before, after, platformIcon }) => {
    return (
        <div className="flex flex-col md:flex-row items-center gap-4 p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm w-full">
            <div className="flex-1 w-full">
                <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Before</p>
                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded border border-dashed border-slate-300 dark:border-slate-700 font-mono text-sm break-all text-slate-600 dark:text-slate-400">
                    {before}
                </div>
            </div>
            
            <div className="text-slate-300 dark:text-slate-700 rotate-90 md:rotate-0">
                <ArrowRight size={24} />
            </div>

            <div className="flex-1 w-full">
                <p className="text-xs font-semibold text-blue-500 uppercase mb-2">After Legible Links</p>
                <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded border border-blue-200 dark:border-blue-800/50 flex items-center gap-2 text-slate-900 dark:text-slate-100 font-medium">
                    <span className="text-blue-600 dark:text-blue-400">{platformIcon}</span>
                    {after}
                </div>
            </div>
        </div>
    );
};
