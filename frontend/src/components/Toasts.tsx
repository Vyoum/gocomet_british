import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/** Tiny dependency-free toast store: stacked, auto-dismiss (~5s), announced via role="status", hidden in print. */
export type ToastKind = 'info' | 'success' | 'error' | 'warn';
export interface Toast { id: number; kind: ToastKind; text: string; link?: { to: string; label: string } }
let seq = 0;
let items: Toast[] = [];
const subs = new Set<(t: Toast[]) => void>();
const emit = () => subs.forEach((f) => f(items));
export function dismissToast(id: number) { items = items.filter((t) => t.id !== id); emit(); }
export function toast(kind: ToastKind, text: string, link?: Toast['link'], ms = 5000) {
  const t = { id: ++seq, kind, text, link };
  items = [...items.slice(-4), t]; emit();
  window.setTimeout(() => dismissToast(t.id), ms);
  return t.id;
}

const STYLE: Record<ToastKind, string> = {
  info: 'border-sky-300 bg-sky-50 text-sky-900', success: 'border-green-300 bg-green-50 text-green-900',
  error: 'border-red-300 bg-red-50 text-red-900', warn: 'border-amber-300 bg-amber-50 text-amber-900',
};

export default function Toaster() {
  const [list, setList] = useState(items);
  useEffect(() => { subs.add(setList); return () => { subs.delete(setList); }; }, []);
  return (
    <div className="no-print pointer-events-none fixed inset-x-2 bottom-2 z-50 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96" data-testid="toasts">
      {list.map((t) => (
        <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} aria-live={t.kind === 'error' ? 'assertive' : 'polite'} data-kind={t.kind}
          className={`toast pointer-events-auto flex items-start gap-2 rounded border px-3 py-2 text-sm shadow-lg ${STYLE[t.kind]}`}>
          <span className="min-w-0 flex-1 break-words">{t.text}{t.link && <> <Link to={t.link.to} className="font-semibold underline" onClick={() => dismissToast(t.id)}>{t.link.label}</Link></>}</span>
          <button type="button" aria-label="Dismiss notification" className="-m-1 shrink-0 px-2 py-1 leading-none opacity-60 hover:opacity-100" onClick={() => dismissToast(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
