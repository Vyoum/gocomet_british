import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, RfqDetails, Supplier, subscribe } from '../api';
import { Countdown, fmtDate, fmtMoney, StatusBadge, triggerLabel } from '../components/ui';

export default function DetailsPage() {
  const { id = '' } = useParams();
  const [rfq, setRfq] = useState<RfqDetails | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api.rfq(id).then(setRfq).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); return subscribe((rid) => (rid === id || rid === '*') && load()); }, [id, load]);
  if (!rfq) return <p className="text-slate-500">{err || 'Loading…'}</p>;

  return (
    <div className="space-y-6">
      <Link to="/" className="text-sm text-indigo-700">← All auctions</Link>
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{rfq.name} <StatusBadge s={rfq.status} /></h1>
            <p className="text-sm text-slate-500">{rfq.referenceId} · Pickup {fmtDate(rfq.pickupDate)}</p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase text-slate-500">Time remaining</div>
            <div className="text-2xl"><Countdown to={rfq.currentCloseTime} from={rfq.bidStartTime} onZero={load} /></div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
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
        <div className="card overflow-x-auto p-0 lg:col-span-2">
          <h2 className="p-5 pb-2 font-semibold">Ranking (latest bid per supplier)</h2>
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
          {rfq.allBids.length > rfq.rankedBids.length && (
            <details className="p-5 text-sm"><summary className="cursor-pointer text-slate-600">All bids incl. superseded ({rfq.allBids.length})</summary>
              <ul className="mt-2 space-y-1">{rfq.allBids.map((b) => <li key={b.id}>{fmtDate(b.createdAt)} — {b.supplierName}: {fmtMoney(b.totalPrice)}</li>)}</ul>
            </details>)}
        </div>
        <BidForm rfq={rfq} onDone={load} />
      </div>
      <div className="card">
        <h2 className="mb-3 font-semibold">Activity log</h2>
        <ul className="space-y-2 text-sm">
          {rfq.activity.map((a) => (
            <li key={a.id} className="flex gap-3">
              <span className="w-44 shrink-0 text-xs text-slate-500">{fmtDate(a.createdAt)}</span>
              <span className={`shrink-0 rounded px-1.5 text-xs font-semibold ${a.type === 'EXTENDED' ? 'bg-amber-100 text-amber-800' : a.type === 'BID_PLACED' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100'}`}>{a.type}</span>
              <span>{a.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const Info = ({ k, v, wide }: { k: string; v: string; wide?: boolean }) => (
  <div className={wide ? 'col-span-2' : ''}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>
);

function BidForm({ rfq, onDone }: { rfq: RfqDetails; onDone: () => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [f, setF] = useState({ supplierId: '', freightCharges: '', originCharges: '', destinationCharges: '', transitTimeDays: '7', quoteValidUntil: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { api.suppliers().then((s) => { setSuppliers(s); setF((x) => ({ ...x, supplierId: x.supplierId || s[0]?.id || '' })); }); }, []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const total = (+f.freightCharges || 0) + (+f.originCharges || 0) + (+f.destinationCharges || 0);
  const mine = rfq.rankedBids.find((b) => b.supplierId === f.supplierId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await api.placeBid(rfq.id, { ...f, quoteValidUntil: new Date(f.quoteValidUntil).toISOString() });
      setMsg({ ok: true, text: `Bid accepted — you are L${r.rank}.${r.extension.extend ? ' ' + r.extension.reason : ''}` });
      onDone();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }
  const open = rfq.status === 'ACTIVE';
  return (
    <form onSubmit={submit} className="card space-y-3">
      <h2 className="font-semibold">Submit quote</h2>
      <div><label className="label">Acting as carrier (demo — no auth)</label>
        <select className="input" value={f.supplierId} onChange={set('supplierId')}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        {mine && <p className="mt-1 text-xs text-slate-500">Your current bid: {fmtMoney(mine.totalPrice)} ({mine.label}). Re-bids must be lower.</p>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="label">Freight</label><input required type="number" min={0} step="0.01" className="input" value={f.freightCharges} onChange={set('freightCharges')} /></div>
        <div><label className="label">Origin</label><input required type="number" min={0} step="0.01" className="input" value={f.originCharges} onChange={set('originCharges')} /></div>
        <div><label className="label">Destination</label><input required type="number" min={0} step="0.01" className="input" value={f.destinationCharges} onChange={set('destinationCharges')} /></div>
      </div>
      <p className="text-sm">Total: <b>{fmtMoney(total)}</b></p>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Transit time (days)</label><input required type="number" min={1} className="input" value={f.transitTimeDays} onChange={set('transitTimeDays')} /></div>
        <div><label className="label">Quote valid until</label><input required type="date" className="input" value={f.quoteValidUntil} onChange={set('quoteValidUntil')} /></div>
      </div>
      <button className="btn w-full" disabled={!open}>{open ? 'Submit bid' : `Bidding ${rfq.status === 'UPCOMING' ? 'not started' : 'closed'}`}</button>
      {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
    </form>
  );
}
