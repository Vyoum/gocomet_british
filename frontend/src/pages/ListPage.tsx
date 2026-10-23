import { useCallback, useEffect, useState } from 'react';
import { canCreate, useRole } from '../role';
import { Link } from 'react-router-dom';
import { api, RfqSummary, subscribe, TopRank } from '../api';
import { Countdown, fmtDate, fmtMoney, StatusBadge } from '../components/ui';

function Leaders({ ranks, chips }: { ranks?: TopRank[]; chips?: boolean }) {
  if (!ranks?.length) return <div className="text-xs text-slate-400" data-testid="leaders">No bids yet</div>;
  return (
    <ul className={chips ? 'flex flex-wrap gap-1.5' : 'space-y-0.5'} data-testid="leaders">
      {ranks.map((t) => (
        <li key={t.rank} title={`L${t.rank} ${t.carrierName} ${fmtMoney(t.total)}`}
          className={`flex min-w-0 max-w-full items-center gap-1.5 text-xs ${chips ? `rounded-full px-2 py-0.5 ${t.rank === 1 ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-slate-100'}` : ''}`}>
          <span className={`shrink-0 font-semibold ${t.rank === 1 ? 'text-emerald-700' : 'text-slate-500'}`}>L{t.rank}</span>
          <span className={`min-w-0 truncate ${chips ? 'max-w-[9rem]' : 'max-w-[10rem]'} ${t.rank === 1 ? 'text-emerald-800 font-medium' : 'text-slate-700'}`}>{t.carrierName}</span>
          <span className={`shrink-0 tabular-nums ${t.rank === 1 ? 'text-emerald-700 font-semibold' : 'text-slate-600'}`}>{fmtMoney(t.total)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ListPage() {
  const [rfqs, setRfqs] = useState<RfqSummary[]>([]);
  const [err, setErr] = useState('');
  const role = useRole();
  const load = useCallback(() => api.rfqs().then(setRfqs).catch((e) => setErr(e.message)), [role]); // refetch on role switch
  useEffect(() => { load(); return subscribe(load); }, [load]);

  return (
    <div className="card p-0">
      <div className="flex items-center justify-between gap-3 p-4 sm:p-5">
        <h1 className="text-lg font-semibold">British Auctions</h1>
        {canCreate(role) ? <Link to="/new" className="btn no-print">+ New RFQ</Link>
          : <span className="no-print text-right text-xs text-slate-500" data-testid="no-create-note">Suppliers can't create RFQs (demo role)</span>}
      </div>
      {err && <p className="px-5 text-red-600">{err}</p>}
      <ul className="divide-y divide-slate-100 border-t border-slate-100 md:hidden print-hide" data-testid="rfq-cards">
        {rfqs.map((r) => (
          <li key={r.id}>
            <Link to={`/rfq/${r.id}`} className="block p-4 active:bg-slate-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="break-words font-medium text-indigo-700">{r.name}</div><div className="text-xs text-slate-500">{r.referenceId}{' '}{r.myRank != null && <span className="ml-1 inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800" data-testid="my-rank">You are L{r.myRank}</span>}</div></div>
                <StatusBadge s={r.status} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-slate-500">Lowest bid</dt><dd className="font-semibold">{fmtMoney(r.lowestBid)}</dd></div>
                <div><dt className="text-xs text-slate-500">Time left</dt><dd><Countdown to={r.currentCloseTime} from={r.bidStartTime} onZero={load} /></dd></div>
                <div><dt className="text-xs text-slate-500">Current close</dt><dd>{fmtDate(r.currentCloseTime)}{r.extensionCount > 0 && <span className="ml-1 text-xs text-amber-700">(+{r.extensionCount} ext)</span>}</dd></div>
                <div><dt className="text-xs text-slate-500">Forced close</dt><dd>{fmtDate(r.forcedCloseTime)}</dd></div>
                <div><dt className="text-xs text-slate-500">Bids</dt><dd>{r.bidCount}</dd></div>
              </dl>
              <div className="mt-3"><div className="mb-1 text-xs text-slate-500">Leaders</div><Leaders ranks={r.topRanks} chips /></div>
            </Link>
          </li>
        ))}
        {!rfqs.length && <li className="p-4 text-sm text-slate-500">No RFQs yet.</li>}
      </ul>
      <div className="hidden overflow-x-auto md:block print-show">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50"><tr>
          {['RFQ', 'Lowest Bid', 'Current Close', 'Time Left', 'Forced Close', 'Bids', 'Status'].map((h) => <th key={h} className="th">{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rfqs.map((r) => (
            <tr key={r.id} className="print-row hover:bg-slate-50">
              <td className="td print-wrap"><Link className="font-medium text-indigo-700 hover:underline" to={`/rfq/${r.id}`}>{r.name}</Link><div className="text-xs text-slate-500">{r.referenceId}{' '}{r.myRank != null && <span className="ml-1 inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800" data-testid="my-rank">You are L{r.myRank}</span>}</div></td>
              <td className="td print-wrap"><div className="font-semibold">{fmtMoney(r.lowestBid)}</div><div className="mt-1"><Leaders ranks={r.topRanks} /></div></td>
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
