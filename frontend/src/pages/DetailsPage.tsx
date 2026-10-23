import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, HttpError, RfqDetails, Supplier, subscribe } from '../api';
import { canBid, Role, sameName, useRole } from '../role';
import InfoTip from '../components/InfoTip';
import { toast } from '../components/Toasts';
import { downloadBidsCsv } from '../csv';
import { Countdown, fmtDate, fmtMoney, StatusBadge, fmtActivity, triggerLabel } from '../components/ui';

export default function DetailsPage() {
  const { id = '' } = useParams();
  const [rfq, setRfq] = useState<RfqDetails | null>(null);
  const [err, setErr] = useState('');
  const role = useRole();
  const prev = useRef<RfqDetails | null>(null);
  const load = useCallback(() => api.rfq(id).then((r) => {
    // Live toasts for the RFQ being viewed: extension and close transitions seen via SSE refetches.
    const p = prev.current;
    if (p && p.id === r.id) {
      if (r.extensionCount > p.extensionCount)
        toast('info', `Auction ${r.referenceId} extended — now closes ${fmtDate(r.currentCloseTime)}${r.currentCloseTime === r.forcedCloseTime ? ' (capped at forced close)' : ''}`);
      if ((p.status === 'ACTIVE' || p.status === 'UPCOMING') && (r.status === 'CLOSED' || r.status === 'FORCE_CLOSED'))
        toast('warn', `Auction ${r.referenceId} ${r.status === 'FORCE_CLOSED' ? 'force closed (forced close time reached)' : 'closed'}`);
    }
    prev.current = r; setRfq(r);
  }).catch((e) => setErr(e.message)), [id, role]);
  useEffect(() => { load(); return subscribe((rid) => (rid === id || rid === '*') && load()); }, [id, load]);
  if (!rfq) return <p className="text-slate-500">{err || 'Loading…'}</p>;
  const isMe = (name: string) => role.kind === 'supplier' && sameName(name, role.name);
  const myBid = role.kind === 'supplier' ? rfq.rankedBids.find((b) => isMe(b.supplierName)) : undefined;

  return (
    <div className="space-y-4 sm:space-y-6">
      <Link to="/" className="no-print inline-block py-1 text-sm text-indigo-700">← All auctions</Link>
      <div className="card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="print-wrap break-words text-lg font-semibold sm:text-xl">{rfq.name} <StatusBadge s={rfq.status} /></h1>
            <p className="text-sm text-slate-500">{rfq.referenceId} · Pickup {fmtDate(rfq.pickupDate)}</p>
          </div>
          <div className="sm:text-right">
            <div className="text-xs uppercase text-slate-500">Time remaining <InfoTip label="Auto-extension (British auction)">{EXT_TIP(rfq.triggerWindowMinutes, rfq.extensionMinutes, triggerLabel[rfq.triggerType])}</InfoTip></div>
            <div className="text-xl sm:text-2xl"><Countdown to={rfq.currentCloseTime} from={rfq.bidStartTime} onZero={load} /></div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm min-[380px]:grid-cols-2 md:grid-cols-4">
          <Info k="Bid start" v={fmtDate(rfq.bidStartTime)} />
          <Info k="Original close" v={fmtDate(rfq.bidCloseTime)} />
          <Info k="Current close" v={`${fmtDate(rfq.currentCloseTime)}${rfq.extensionCount ? ` (+${rfq.extensionCount} ext)` : ''}`} />
          <Info k="Forced close" v={fmtDate(rfq.forcedCloseTime)} tip={<InfoTip label="Forced close cap">{CAP_TIP}</InfoTip>} />
          <Info k="Trigger window (X)" v={`${rfq.triggerWindowMinutes} min`} tip={<InfoTip label="Extension trigger window">{EXT_TIP(rfq.triggerWindowMinutes, rfq.extensionMinutes, triggerLabel[rfq.triggerType])}</InfoTip>} />
          <Info k="Extension (Y)" v={`${rfq.extensionMinutes} min`} tip={<InfoTip label="Extension amount">Each qualifying bid adds {rfq.extensionMinutes} min to the <i>current</i> close time (so extensions can stack), but never past the forced close time — if only part fits, only that part is added.</InfoTip>} />
          <Info k="Trigger" v={triggerLabel[rfq.triggerType]} wide />
        </dl>
      </div>
      {role.kind === 'supplier' && (
        <div className="rounded border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-900" data-testid="my-rank-banner">
          {myBid ? <>You are <b>{myBid.label}</b> ({role.name}, {fmtMoney(myBid.totalPrice)})</> : <>{role.name} has not bid on this RFQ yet</>}
        </div>
      )}
      <div className="print-block grid gap-6 lg:grid-cols-3">
        <div className="card print-full min-w-0 p-0 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 p-4 pb-2 sm:p-5 sm:pb-2">
            <h2 className="font-semibold">Ranking (latest bid per supplier)</h2>
            <InfoTip label="How ranking works (ties)">Only each supplier's latest bid counts. Lowest total price is L1. On an exact tie, the <b>earlier bid wins</b> (ranked by total, then bid time).</InfoTip>
            <InfoTip label="Concurrent bids are safe">Every bid locks this RFQ's row in the database (<code>SELECT … FOR UPDATE</code>). Simultaneous bids are processed one at a time, so each sees the previous bid, the correct ranking and any already-extended close time — no lost updates or double extensions.</InfoTip>
            <button type="button" className="no-print ml-auto rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50" data-testid="export-csv"
              disabled={!rfq.allBids.length} onClick={() => downloadBidsCsv(rfq)}>⬇ Export CSV</button>
          </div>
          <ul className="space-y-2 px-4 pb-4 md:hidden print-hide" data-testid="rank-cards">
            {rfq.rankedBids.map((b) => (
              <li key={b.id} className={`rounded border p-3 text-sm ${isMe(b.supplierName) ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-300' : b.rank === 1 ? 'border-green-300 bg-green-50' : 'border-slate-200'}`} data-me={isMe(b.supplierName) || undefined}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words"><b className="mr-2">{b.label}</b>{b.supplierName}</span>
                  <span className="shrink-0 font-semibold">{fmtMoney(b.totalPrice)}</span>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-slate-500">Freight</dt><dd>{fmtMoney(b.freightCharges)}</dd></div>
                  <div><dt className="text-slate-500">Origin</dt><dd>{fmtMoney(b.originCharges)}</dd></div>
                  <div><dt className="text-slate-500">Destination</dt><dd>{fmtMoney(b.destinationCharges)}</dd></div>
                  <div><dt className="text-slate-500">Transit</dt><dd>{b.transitTimeDays} d</dd></div>
                  <div><dt className="text-slate-500">Valid until</dt><dd>{new Date(b.quoteValidUntil).toLocaleDateString()}</dd></div>
                  <div><dt className="text-slate-500">Bid at</dt><dd>{fmtDate(b.createdAt)}</dd></div>
                </dl>
              </li>
            ))}
            {!rfq.rankedBids.length && <li className="text-sm text-slate-500">No bids yet.</li>}
          </ul>
          <div className="hidden overflow-x-auto md:block print-show">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50"><tr>{['Rank', 'Carrier', 'Freight', 'Origin', 'Destination', 'Total', 'Transit', 'Valid until', 'Bid at'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rfq.rankedBids.map((b) => (
                <tr key={b.id} className={`print-row ${isMe(b.supplierName) ? 'bg-indigo-50 outline outline-2 -outline-offset-2 outline-indigo-300' : b.rank === 1 ? 'bg-green-50' : ''}`} data-me={isMe(b.supplierName) || undefined}>
                  <td className="td font-bold">{b.label}</td><td className="td print-wrap">{b.supplierName}{isMe(b.supplierName) && <span className="ml-1 text-xs font-semibold text-indigo-700">(you)</span>}</td>
                  <td className="td">{fmtMoney(b.freightCharges)}</td><td className="td">{fmtMoney(b.originCharges)}</td><td className="td">{fmtMoney(b.destinationCharges)}</td>
                  <td className="td font-semibold">{fmtMoney(b.totalPrice)}</td><td className="td">{b.transitTimeDays} d</td>
                  <td className="td">{new Date(b.quoteValidUntil).toLocaleDateString()}</td><td className="td text-xs">{fmtDate(b.createdAt)}</td>
                </tr>
              ))}
              {!rfq.rankedBids.length && <tr><td colSpan={9} className="td text-slate-500">No bids yet.</td></tr>}
            </tbody>
          </table>
          </div>
          {rfq.allBids.length > rfq.rankedBids.length && (
            <details className="p-4 text-sm sm:p-5"><summary className="cursor-pointer text-slate-600">All bids incl. superseded ({rfq.allBids.length})</summary>
              <ul className="mt-2 space-y-1">{rfq.allBids.map((b) => <li key={b.id} className="print-wrap break-words">{fmtDate(b.createdAt)} — {b.supplierName}: {fmtMoney(b.totalPrice)}</li>)}</ul>
            </details>)}
        </div>
        {canBid(role) ? <BidForm rfq={rfq} onDone={load} role={role} />
          : <div className="card no-print min-w-0 text-sm text-slate-600" data-testid="buyer-note"><h2 className="mb-1 font-semibold text-slate-900">Submit quote</h2>You are viewing as the <b>Buyer</b>. Buyers can't submit bids — switch to a supplier role in the header (demo, no auth).</div>}
      </div>
      <div className="card">
        <h2 className="mb-3 font-semibold">Activity log</h2>
        <ul className="space-y-2 text-sm">
          {rfq.activity.map((a) => (
            <li key={a.id} className="print-row flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-100 pb-2 last:border-0 sm:flex-nowrap sm:border-0 sm:pb-0">
              <span className="shrink-0 text-xs text-slate-500 sm:w-44">{fmtDate(a.createdAt)}</span>
              <span title={a.type} className={`shrink-0 whitespace-nowrap rounded px-1.5 text-xs font-semibold ${ACTIVITY_STYLE[a.type]?.cls ?? 'bg-slate-100'}`}>{ACTIVITY_STYLE[a.type]?.label ?? a.type}</span>
              <span className="print-wrap min-w-0 basis-full break-words sm:basis-auto">{fmtActivity(a.message)}{a.type === 'EXTENSION_CAPPED' && <> <InfoTip label="Why was the extension capped?">{CAP_TIP}</InfoTip></>}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const ACTIVITY_STYLE: Record<string, { label: string; cls: string }> = {
  RFQ_CREATED: { label: 'RFQ_CREATED', cls: 'bg-slate-100' },
  BID_PLACED: { label: 'BID_PLACED', cls: 'bg-indigo-100 text-indigo-800' },
  EXTENDED: { label: 'EXTENDED', cls: 'bg-amber-100 text-amber-800' },
  EXTENSION_CAPPED: { label: 'EXTENSION CAPPED', cls: 'bg-orange-100 text-orange-800 ring-1 ring-orange-300' },
  AUCTION_CLOSED: { label: 'CLOSED', cls: 'bg-slate-200 text-slate-800' },
  AUCTION_FORCE_CLOSED: { label: 'FORCE CLOSED', cls: 'bg-red-100 text-red-800' },
};

const EXT_TIP = (x: number, y: number, trig: string) => <>If a qualifying bid ({trig}) arrives in the last <b>{x} min</b> before the current close time, the close moves out by <b>{y} min</b>. The window is measured from the current (possibly already extended) close. Bids outside the window never extend. Extensions never go past the forced close time.</>;
const CAP_TIP = <>Hard stop: the auction can never run past the forced close time. An extension that would overshoot is cut to end exactly at it (logged as EXTENSION_CAPPED with requested vs granted minutes); once the close equals the forced close, further triggers add nothing and the auction ends as Force Closed.</>;

const Info = ({ k, v, wide, tip }: { k: string; v: string; wide?: boolean; tip?: ReactNode }) => (
  <div className={`min-w-0 break-words ${wide ? 'min-[380px]:col-span-2' : ''}`}><dt className="text-xs text-slate-500">{k}{tip && <> {tip}</>}</dt><dd className="font-medium">{v}</dd></div>
);

function BidForm({ rfq, onDone, role }: { rfq: RfqDetails; onDone: () => void; role: Role }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [f, setF] = useState({ supplierId: '', freightCharges: '', originCharges: '', destinationCharges: '', transitTimeDays: '7', quoteValidUntil: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // One Idempotency-Key per submission: reused if the same payload is re-submitted after an unknown outcome.
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const fixed = role.kind === 'supplier' ? role.name : null;
  useEffect(() => {
    api.suppliers().then((s) => {
      setSuppliers(s);
      const own = fixed ? s.find((x) => sameName(x.name, fixed))?.id ?? '' : '';
      setF((x) => ({ ...x, supplierId: fixed ? own : x.supplierId || s[0]?.id || '' }));
    });
  }, [fixed]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const total = (+f.freightCharges || 0) + (+f.originCharges || 0) + (+f.destinationCharges || 0);
  const mine = rfq.rankedBids.find((b) => b.supplierId === f.supplierId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setMsg(null);
    const body = { ...f, quoteValidUntil: new Date(f.quoteValidUntil).toISOString() };
    const payload = JSON.stringify(body);
    if (attempt.current?.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    setBusy(true);
    try {
      const r = await api.placeBid(rfq.id, body, attempt.current.key);
      attempt.current = null;
      const ext = r.extension.extend || r.extension.cappedAtForcedClose ? ' ' + r.extension.reason : '';
      const text = r.replayed ? `Bid already recorded (idempotent replay) — you are L${r.rank}.` : `Bid accepted — you are L${r.rank}.${ext}`;
      setMsg({ ok: true, text });
      toast('success', `${rfq.referenceId}: ${text}`);
      onDone();
    } catch (e) {
      // Definitive rejections (4xx) mean the next submit is a new attempt; otherwise keep the key for a safe retry.
      if (e instanceof HttpError && e.status < 500) attempt.current = null;
      setMsg({ ok: false, text: (e as Error).message });
      toast('error', `${rfq.referenceId}: bid rejected — ${(e as Error).message}`);
    } finally { setBusy(false); }
  }
  const open = rfq.status === 'ACTIVE';
  return (
    <form onSubmit={submit} className="card no-print min-w-0 space-y-3">
      <h2 className="flex items-center gap-1 font-semibold">Submit quote <InfoTip label="Bid validation rules">Bids are accepted only while the auction is <b>Active</b> (409 otherwise). Charges must be ≥ 0 with at most 2 decimals, and the total must be &gt; 0. Transit days: a whole number &gt; 0. Quote validity must be in the future. A re-bid must be strictly <b>lower</b> than your previous bid; only your latest bid is ranked.</InfoTip></h2>
      <div><label className="label">{fixed ? 'Bidding as (demo role)' : 'Acting as carrier (demo — no auth)'}</label>
        {fixed ? <div className="input bg-slate-50 font-medium" data-testid="fixed-carrier">{fixed}</div>
          : <select className="input" value={f.supplierId} onChange={set('supplierId')}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        {mine && <p className="mt-1 text-xs text-slate-500">Your current bid: {fmtMoney(mine.totalPrice)} ({mine.label}). Re-bids must be lower.</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-2 lg:grid-cols-1 xl:grid-cols-3">
        <div><label className="label">Freight</label><input required type="number" inputMode="decimal" min={0} step="0.01" className="input" value={f.freightCharges} onChange={set('freightCharges')} /></div>
        <div><label className="label">Origin</label><input required type="number" inputMode="decimal" min={0} step="0.01" className="input" value={f.originCharges} onChange={set('originCharges')} /></div>
        <div><label className="label">Destination</label><input required type="number" inputMode="decimal" min={0} step="0.01" className="input" value={f.destinationCharges} onChange={set('destinationCharges')} /></div>
      </div>
      <p className="flex items-center gap-1 text-sm">Total: <b>{fmtMoney(total)}</b> <InfoTip label="Money in minor units">Amounts are stored as whole cents (integer minor units), never floating point, so totals and comparisons are exact. Enter up to 2 decimals; more is rejected rather than rounded.</InfoTip></p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
        <div><label className="label">Transit time (days)</label><input required type="number" inputMode="numeric" min={1} className="input" value={f.transitTimeDays} onChange={set('transitTimeDays')} /></div>
        <div><label className="label">Quote valid until</label><input required type="date" className="input" value={f.quoteValidUntil} onChange={set('quoteValidUntil')} /></div>
      </div>
      <div className="flex items-center gap-1">
        <button className="btn min-w-0 flex-1" disabled={!open || busy} aria-busy={busy}>{busy ? 'Submitting…' : open ? 'Submit bid' : `Bidding ${rfq.status === 'UPCOMING' ? 'not started' : 'closed'}`}</button>
        <InfoTip label="Safe to retry (idempotency)">Each submission carries a unique <code>Idempotency-Key</code>. Network failures/5xx are retried automatically with the same key, and re-submitting the same form re-uses it — the server replays the original result ("already recorded") instead of creating a duplicate bid or extension. Reusing a key with a different payload is rejected (422).</InfoTip>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
    </form>
  );
}
