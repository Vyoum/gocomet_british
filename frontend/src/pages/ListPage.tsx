import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, RfqSummary, subscribe } from '../api';
import { Countdown, fmtDate, fmtMoney, StatusBadge } from '../components/ui';

export default function ListPage() {
  const [rfqs, setRfqs] = useState<RfqSummary[]>([]);
  const [err, setErr] = useState('');
  const load = useCallback(() => api.rfqs().then(setRfqs).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); return subscribe(load); }, [load]);

  return (
    <div className="card p-0">
      <div className="flex items-center justify-between gap-3 p-4 sm:p-5">
        <h1 className="text-lg font-semibold">British Auctions</h1>
        <Link to="/new" className="btn">+ New RFQ</Link>
      </div>
      {err && <p className="px-5 text-red-600">{err}</p>}
      <ul className="divide-y divide-slate-100 border-t border-slate-100 md:hidden" data-testid="rfq-cards">
        {rfqs.map((r) => (
          <li key={r.id}>
            <Link to={`/rfq/${r.id}`} className="block p-4 active:bg-slate-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="break-words font-medium text-indigo-700">{r.name}</div><div className="text-xs text-slate-500">{r.referenceId}</div></div>
                <StatusBadge s={r.status} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-slate-500">Lowest bid</dt><dd className="font-semibold">{fmtMoney(r.lowestBid)}</dd></div>
                <div><dt className="text-xs text-slate-500">Time left</dt><dd><Countdown to={r.currentCloseTime} from={r.bidStartTime} onZero={load} /></dd></div>
                <div><dt className="text-xs text-slate-500">Current close</dt><dd>{fmtDate(r.currentCloseTime)}{r.extensionCount > 0 && <span className="ml-1 text-xs text-amber-700">(+{r.extensionCount} ext)</span>}</dd></div>
                <div><dt className="text-xs text-slate-500">Forced close</dt><dd>{fmtDate(r.forcedCloseTime)}</dd></div>
                <div><dt className="text-xs text-slate-500">Bids</dt><dd>{r.bidCount}</dd></div>
              </dl>
            </Link>
          </li>
        ))}
        {!rfqs.length && <li className="p-4 text-sm text-slate-500">No RFQs yet.</li>}
      </ul>
      <div className="hidden overflow-x-auto md:block">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50"><tr>
          {['RFQ', 'Lowest Bid', 'Current Close', 'Time Left', 'Forced Close', 'Bids', 'Status'].map((h) => <th key={h} className="th">{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rfqs.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="td"><Link className="font-medium text-indigo-700 hover:underline" to={`/rfq/${r.id}`}>{r.name}</Link><div className="text-xs text-slate-500">{r.referenceId}</div></td>
              <td className="td font-semibold">{fmtMoney(r.lowestBid)}</td>
              <td className="td">{fmtDate(r.currentCloseTime)}{r.extensionCount > 0 && <span className="ml-1 text-xs text-amber-700">(+{r.extensionCount} ext)</span>}</td>
              <td className="td"><Countdown to={r.currentCloseTime} from={r.bidStartTime} onZero={load} /></td>
              <td className="td">{fmtDate(r.forcedCloseTime)}</td>
              <td className="td">{r.bidCount}</td>
              <td className="td"><StatusBadge s={r.status} /></td>
            </tr>
          ))}
          {!rfqs.length && <tr><td className="td text-slate-500" colSpan={7}>No RFQs yet.</td></tr>}
        </tbody>
      </table>
      </div>
    </div>
  );
}
