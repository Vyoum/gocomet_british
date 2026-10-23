import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, HttpError, RfqDetails, Supplier, subscribe } from '../api';
import { Countdown, fmtDate, fmtMoney, StatusBadge, fmtActivity, triggerLabel } from '../components/ui';

export default function DetailsPage() {
  const { id = '' } = useParams();
  const [rfq, setRfq] = useState<RfqDetails | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api.rfq(id).then(setRfq).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); return subscribe((rid) => (rid === id || rid === '*') && load()); }, [id, load]);
  if (!rfq) return <p className="text-slate-500">{err || 'Loading…'}</p>;

  return (
    <div className="space-y-4 sm:space-y-6">
      <Link to="/" className="inline-block py-1 text-sm text-indigo-700">← All auctions</Link>
      <div className="card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="break-words text-lg font-semibold sm:text-xl">{rfq.name} <StatusBadge s={rfq.status} /></h1>
            <p className="text-sm text-slate-500">{rfq.referenceId} · Pickup {fmtDate(rfq.pickupDate)}</p>
          </div>
          <div className="sm:text-right">
            <div className="text-xs uppercase text-slate-500">Time remaining</div>
            <div className="text-xl sm:text-2xl"><Countdown to={rfq.currentCloseTime} from={rfq.bidStartTime} onZero={load} /></div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm min-[380px]:grid-cols-2 md:grid-cols-4">
          <Info k="Bid start" v={fmtDate(rfq.bidStartTime)} />
          <Info k="Original close" v={fmtDate(rfq.bidCloseTime)} />
          <Info k="Current close" v={`${fmtDate(rfq.currentCloseTime)}${rfq.extensionCount ? ` (+${rfq.extensionCount} ext)` : ''}`} />
          <Info k="Forced close" v={fmtDate(rfq.forcedCloseTime)} />
          <Info k="Trigger window (X)" v={`${rfq.triggerWindowMinutes} min`} />
          <Info k="Extension (Y)" v={`${rfq.extensionMinutes} min`} />
          <Info k="Trigger" v={triggerLabel[rfq.triggerType]} wide />
        </dl>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card min-w-0 p-0 lg:col-span-2">
          <h2 className="p-4 pb-2 font-semibold sm:p-5 sm:pb-2">Ranking (latest bid per supplier)</h2>
          <ul className="space-y-2 px-4 pb-4 md:hidden" data-testid="rank-cards">
            {rfq.rankedBids.map((b) => (
              <li key={b.id} className={`rounded border p-3 text-sm ${b.rank === 1 ? 'border-green-300 bg-green-50' : 'border-slate-200'}`}>
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
          <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50"><tr>{['Rank', 'Carrier', 'Freight', 'Origin', 'Destination', 'Total', 'Transit', 'Valid until', 'Bid at'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rfq.rankedBids.map((b) => (
                <tr key={b.id} className={b.rank === 1 ? 'bg-green-50' : ''}>
                  <td className="td font-bold">{b.label}</td><td className="td">{b.supplierName}</td>
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
              <ul className="mt-2 space-y-1">{rfq.allBids.map((b) => <li key={b.id} className="break-words">{fmtDate(b.createdAt)} — {b.supplierName}: {fmtMoney(b.totalPrice)}</li>)}</ul>
            </details>)}
        </div>
        <BidForm rfq={rfq} onDone={load} />
      </div>
      <div className="card">
        <h2 className="mb-3 font-semibold">Activity log</h2>
        <ul className="space-y-2 text-sm">
          {rfq.activity.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-100 pb-2 last:border-0 sm:flex-nowrap sm:border-0 sm:pb-0">
              <span className="shrink-0 text-xs text-slate-500 sm:w-44">{fmtDate(a.createdAt)}</span>
              <span title={a.type} className={`shrink-0 whitespace-nowrap rounded px-1.5 text-xs font-semibold ${ACTIVITY_STYLE[a.type]?.cls ?? 'bg-slate-100'}`}>{ACTIVITY_STYLE[a.type]?.label ?? a.type}</span>
              <span className="min-w-0 basis-full break-words sm:basis-auto">{fmtActivity(a.message)}</span>
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

const Info = ({ k, v, wide }: { k: string; v: string; wide?: boolean }) => (
  <div className={`min-w-0 break-words ${wide ? 'min-[380px]:col-span-2' : ''}`}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>
);

function BidForm({ rfq, onDone }: { rfq: RfqDetails; onDone: () => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [f, setF] = useState({ supplierId: '', freightCharges: '', originCharges: '', destinationCharges: '', transitTimeDays: '7', quoteValidUntil: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // One Idempotency-Key per submission: reused if the same payload is re-submitted after an unknown outcome.
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  useEffect(() => { api.suppliers().then((s) => { setSuppliers(s); setF((x) => ({ ...x, supplierId: x.supplierId || s[0]?.id || '' })); }); }, []);
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
      setMsg({ ok: true, text: `Bid accepted — you are L${r.rank}.${ext}` });
      onDone();
    } catch (e) {
      // Definitive rejections (4xx) mean the next submit is a new attempt; otherwise keep the key for a safe retry.
      if (e instanceof HttpError && e.status < 500) attempt.current = null;
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }
  const open = rfq.status === 'ACTIVE';
  return (
    <form onSubmit={submit} className="card min-w-0 space-y-3">
      <h2 className="font-semibold">Submit quote</h2>
      <div><label className="label">Acting as carrier (demo — no auth)</label>
        <select className="input" value={f.supplierId} onChange={set('supplierId')}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        {mine && <p className="mt-1 text-xs text-slate-500">Your current bid: {fmtMoney(mine.totalPrice)} ({mine.label}). Re-bids must be lower.</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-2 lg:grid-cols-1 xl:grid-cols-3">
        <div><label className="label">Freight</label><input required type="number" inputMode="decimal" min={0} step="0.01" className="input" value={f.freightCharges} onChange={set('freightCharges')} /></div>
        <div><label className="label">Origin</label><input required type="number" inputMode="decimal" min={0} step="0.01" className="input" value={f.originCharges} onChange={set('originCharges')} /></div>
        <div><label className="label">Destination</label><input required type="number" inputMode="decimal" min={0} step="0.01" className="input" value={f.destinationCharges} onChange={set('destinationCharges')} /></div>
      </div>
      <p className="text-sm">Total: <b>{fmtMoney(total)}</b></p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
        <div><label className="label">Transit time (days)</label><input required type="number" inputMode="numeric" min={1} className="input" value={f.transitTimeDays} onChange={set('transitTimeDays')} /></div>
        <div><label className="label">Quote valid until</label><input required type="date" className="input" value={f.quoteValidUntil} onChange={set('quoteValidUntil')} /></div>
      </div>
      <button className="btn w-full" disabled={!open || busy} aria-busy={busy}>{busy ? 'Submitting…' : open ? 'Submit bid' : `Bidding ${rfq.status === 'UPCOMING' ? 'not started' : 'closed'}`}</button>
      {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
    </form>
  );
}
