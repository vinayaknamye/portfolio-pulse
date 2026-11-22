import React, { useEffect, useState } from 'react';
import { ExternalLink, FileText, Loader2, X } from 'lucide-react';
import { InsuranceDocument } from '@shared/types';

interface DocumentViewerModalProps {
  document: InsuranceDocument | null;
  onClose: () => void;
  onOpenExternal: (docId: number) => Promise<void>;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  document: doc,
  onClose,
  onOpenExternal
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('');

  useEffect(() => {
    if (!doc) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, onClose]);

  useEffect(() => {
    if (!doc) {
      setBlobUrl(null);
      setTextContent(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);
    setBlobUrl(null);
    setTextContent(null);

    void window.portfolioPulse
      .readInsuranceDocument(doc.id)
      .then((payload) => {
        if (cancelled) return;
        setMimeType(payload.mimeType);
        const binaryStr = atob(payload.base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i += 1) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        if (payload.mimeType.startsWith('text/') || payload.mimeType === 'application/json') {
          const decoded = new TextDecoder('utf-8').decode(bytes);
          setTextContent(decoded);
        } else {
          const blob = new Blob([bytes], { type: payload.mimeType });
          createdUrl = URL.createObjectURL(blob);
          setBlobUrl(createdUrl);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [doc?.id]);

  if (!doc) return null;

  const isPdf = (mimeType || doc.mimeType) === 'application/pdf';
  const isImage = (mimeType || doc.mimeType).startsWith('image/');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[86vh] w-[92vw] max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-white shadow-2xl dark:bg-surface-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-2.5">
            <FileText className="h-4 w-4 shrink-0 text-emerald-500" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {doc.fileName}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    doc.docType === 'renewal'
                      ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {doc.docType === 'renewal' ? 'Renewal Doc' : 'Policy Doc'}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {[doc.docDate && `Date: ${doc.docDate}`, formatFileSize(doc.sizeBytes), doc.notes]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void onOpenExternal(doc.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ExternalLink className="h-3.5 w-3.5 text-emerald-500" />
              Open in System App
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Viewer Body */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-950">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
              Loading document from local vault…
            </div>
          ) : error ? (
            <div className="max-w-md rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-center text-xs text-rose-500">
              <p className="font-semibold">Unable to preview document</p>
              <p className="mt-1">{error}</p>
            </div>
          ) : isPdf && blobUrl ? (
            <iframe
              src={blobUrl}
              title={doc.fileName}
              className="h-full w-full border-0 bg-slate-900"
            />
          ) : isImage && blobUrl ? (
            <div className="flex h-full w-full items-center justify-center overflow-auto p-6">
              <img
                src={blobUrl}
                alt={doc.fileName}
                className="max-h-full max-w-full rounded-xl object-contain shadow-xl"
              />
            </div>
          ) : textContent !== null ? (
            <div className="h-full w-full overflow-auto p-6">
              <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 font-mono text-xs leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                {textContent}
              </pre>
            </div>
          ) : (
            <div className="text-center text-xs text-slate-500 dark:text-slate-400">
              <p>In-app preview is unavailable for this file type.</p>
              <button
                type="button"
                onClick={() => void onOpenExternal(doc.id)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open in System App
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
