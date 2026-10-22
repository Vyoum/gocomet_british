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
    <div className="card overflow-x-auto p-0">
      <div className="flex items-center justify-between p-5">
        <h1 className="text-lg font-semibold">British Auctions</h1>
        <Link to="/new" className="btn">+ New RFQ</Link>
      </div>
      {err && <p className="px-5 text-red-600">{err}</p>}
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
  );
}
