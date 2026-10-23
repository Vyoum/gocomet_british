import { ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * Small ⓘ button explaining an edge-case safeguard. Opens on hover (pointer devices), click/tap or keyboard
 * (Enter/Space); Escape or clicking outside closes. The popover is fixed-positioned and clamped to the viewport.
 */
export default function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const show = open || pinned;

  useLayoutEffect(() => {
    if (!show || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const width = Math.min(288, vw - 16);
      const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, vw - width - 8));
      const h = pop.current?.offsetHeight ?? 0;
      const below = r.bottom + 6;
      const top = below + h > window.innerHeight - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : below;
      setPos({ left, top, width });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const out = (e: Event) => { if (!btn.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) { setPinned(false); setOpen(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPinned(false); setOpen(false); btn.current?.focus(); } };
    document.addEventListener('pointerdown', out); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', esc); };
  }, [show]);

  return (
    <span className="no-print relative inline-flex align-middle">
      <button ref={btn} type="button" aria-label={`Info: ${label}`} aria-expanded={show} aria-controls={show ? id : undefined} data-testid="info-tip"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-sm leading-none text-indigo-600 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPinned((p) => !p); }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false); }}>ⓘ</button>
      {show && (
        <div ref={pop} id={id} role="tooltip" data-testid="info-pop"
          style={{ position: 'fixed', left: pos?.left ?? 8, top: pos?.top ?? 0, width: pos?.width ?? 288, visibility: pos ? 'visible' : 'hidden' }}
          className="z-50 rounded border border-slate-200 bg-white p-3 text-left text-xs font-normal normal-case leading-snug tracking-normal text-slate-700 shadow-lg"
          onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false); }}>
          <b className="mb-1 block text-slate-900">{label}</b>{children}
        </div>
      )}
    </span>
  );
}
