'use client';

import { cn } from '@/lib/utils';
import { FileIcon, Image, FileSpreadsheet, FileText, Download } from 'lucide-react';
import type { Attachment } from '@/lib/api';

interface AttachmentGalleryProps {
  attachments: Attachment[];
  className?: string;
}

function getFileIcon(contentType: string) {
  if (contentType.startsWith('image/')) return Image;
  if (contentType.includes('spreadsheet') || contentType.includes('excel')) return FileSpreadsheet;
  if (contentType.includes('pdf') || contentType.includes('text')) return FileText;
  return FileIcon;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function AttachmentGallery({ attachments, className }: AttachmentGalleryProps) {
  if (attachments.length === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      <h4 className="text-xs font-semibold text-steel-500 uppercase tracking-wider">
        Вложения ({attachments.length})
      </h4>
      <div className="grid grid-cols-2 gap-2">
        {attachments.map((att) => {
          const Icon = getFileIcon(att.content_type);
          const isImage = att.content_type.startsWith('image/');

          return (
            <div
              key={att.id}
              className="group relative rounded-steel border border-steel-100 overflow-hidden hover:border-steel-300 transition-colors cursor-pointer"
            >
              {isImage && att.preview_url ? (
                <div className="aspect-video bg-steel-50">
                  <img
                    src={att.preview_url}
                    alt={att.filename}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="aspect-video bg-steel-50 flex items-center justify-center">
                  <Icon className="w-8 h-8 text-steel-300" />
                </div>
              )}
              <div className="p-2 bg-white">
                <p className="text-xs font-medium text-steel-700 truncate">{att.filename}</p>
                <p className="text-2xs text-steel-400">{formatSize(att.size)}</p>
              </div>
              <button className="absolute top-1.5 right-1.5 p-1 rounded bg-white/80 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
                <Download className="w-3 h-3 text-steel-600" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
