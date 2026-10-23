import { useEffect, useState } from 'react';
import { serverNow, type Status } from '../api';

const styles: Record<Status, string> = {
  UPCOMING: 'bg-sky-100 text-sky-800', ACTIVE: 'bg-green-100 text-green-800',
  CLOSED: 'bg-slate-200 text-slate-700', FORCE_CLOSED: 'bg-red-100 text-red-800',
};
const labels: Record<Status, string> = { UPCOMING: 'Upcoming', ACTIVE: 'Active', CLOSED: 'Closed', FORCE_CLOSED: 'Force Closed' };
export const StatusBadge = ({ s }: { s: Status }) => <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-xs font-semibold ${styles[s]}`}>{labels[s]}</span>;

export const fmtDate = (d: string) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
export const fmtMoney = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD' }));
export const triggerLabel = { BID_RECEIVED: 'Bid received in last X min', ANY_RANK_CHANGE: 'Any supplier rank change in last X min', L1_CHANGE: 'L1 (lowest bidder) change in last X min' } as const;

export function useNow(ms = 1000) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => { const t = setInterval(() => setNow(serverNow()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function Countdown({ to, from, onZero }: { to: string; from?: string; onZero?: () => void }) {
  const now = useNow();
  const target = new Date(to).getTime();
  const diff = Math.max(0, target - now);
  useEffect(() => { if (diff === 0) onZero?.(); }, [diff === 0]); // eslint-disable-line react-hooks/exhaustive-deps
  if (from && new Date(from).getTime() > now) return <span className="text-sky-700">starts in {span(new Date(from).getTime() - now)}</span>;
  if (diff === 0) return <span className="text-slate-500">ended</span>;
  return <span className={diff < 5 * 60000 ? 'font-semibold text-red-600' : 'text-green-700'}>{span(diff)}</span>;
}
/** Compact duration: '6d 22h 4m' (>= 1 day), '3h 4m' (>= 1h), '4m 12s' (< 1h). */
export function span(ms: number) {
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${String(x).padStart(2, '0')}s`;
}

/** Legacy activity rows say 'bid 2350.00'; render any bare amount after bid/re-bid/of as currency. */
export const fmtActivity = (msg: string) =>
  msg.replace(/\b(bid|re-bid|of) (-?\d+(?:\.\d{1,2})?)(?=[\s).,]|$)/g, (_, w: string, n: string) => `${w} ${fmtMoney(Number(n))}`);
