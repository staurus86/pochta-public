'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Code, FileText } from 'lucide-react';

interface EmailBodyViewerProps {
  bodyHtml: string;
  bodyText: string;
  className?: string;
}

export function EmailBodyViewer({ bodyHtml, bodyText, className }: EmailBodyViewerProps) {
  const [mode, setMode] = useState<'html' | 'text'>(bodyHtml ? 'html' : 'text');

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Toggle */}
      <div className="flex items-center gap-1 mb-3 p-0.5 bg-steel-100 rounded-md w-fit">
        <button
          onClick={() => setMode('html')}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-all',
            mode === 'html'
              ? 'bg-white text-steel-900 shadow-sm'
              : 'text-steel-500 hover:text-steel-700',
          )}
        >
          <FileText className="w-3.5 h-3.5" />
          HTML
        </button>
        <button
          onClick={() => setMode('text')}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-all',
            mode === 'text'
              ? 'bg-white text-steel-900 shadow-sm'
              : 'text-steel-500 hover:text-steel-700',
          )}
        >
          <Code className="w-3.5 h-3.5" />
          Текст
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto rounded-steel border border-steel-100 bg-white">
        {mode === 'html' && bodyHtml ? (
          <div
            className="prose prose-sm max-w-none p-5 prose-headings:text-steel-900 prose-p:text-steel-700 prose-a:text-accent-blue"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        ) : (
          <pre className="p-5 text-sm text-steel-700 font-mono whitespace-pre-wrap leading-relaxed">
            {bodyText}
          </pre>
        )}
      </div>
    </div>
  );
}
