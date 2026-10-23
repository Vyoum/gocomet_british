import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, TriggerType } from '../api';
import { triggerLabel } from '../components/ui';
import { canCreate, useRole } from '../role';

const local = (offsetMin: number) => {
  const d = new Date(Date.now() + offsetMin * 60000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function CreatePage() {
  const role = useRole();
  const nav = useNavigate();
  const [f, setF] = useState({
    referenceId: `RFQ-${Math.floor(Math.random() * 9000 + 1000)}`, name: '', bidStartTime: local(0), bidCloseTime: local(15),
    forcedCloseTime: local(30), pickupDate: local(60 * 24 * 3), triggerWindowMinutes: 10, extensionMinutes: 5, triggerType: 'BID_RECEIVED' as TriggerType,
  });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const clientErrors = [
    f.bidCloseTime <= f.bidStartTime && 'Bid close must be after bid start',
    f.forcedCloseTime <= f.bidCloseTime && 'Forced close must be after bid close',
  ].filter(Boolean) as string[];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const iso = (v: string) => new Date(v).toISOString();
      const r = await api.createRfq({ ...f, bidStartTime: iso(f.bidStartTime), bidCloseTime: iso(f.bidCloseTime), forcedCloseTime: iso(f.forcedCloseTime), pickupDate: iso(f.pickupDate) });
      nav(`/rfq/${r.id}`);
    } catch (e) { setErr((e as Error).message); }
  }

  if (!canCreate(role)) return <div className="card text-sm text-slate-600" data-testid="no-create-note">Suppliers can't create RFQs. Switch to <b>Buyer</b> in the header (demo role, no auth).</div>;
  return (
    <form onSubmit={submit} className="card mx-auto max-w-3xl space-y-6">
      <h1 className="text-lg font-semibold">Create RFQ (British Auction)</h1>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><label className="label">RFQ Name</label><input required className="input" value={f.name} onChange={set('name')} placeholder="Mumbai → Rotterdam 2x40HC" /></div>
        <div><label className="label">Reference ID</label><input required className="input" value={f.referenceId} onChange={set('referenceId')} /></div>
        <div><label className="label">Bid Start Date & Time</label><input required type="datetime-local" className="input" value={f.bidStartTime} onChange={set('bidStartTime')} /></div>
        <div><label className="label">Bid Close Date & Time</label><input required type="datetime-local" className="input" value={f.bidCloseTime} onChange={set('bidCloseTime')} /></div>
        <div><label className="label">Forced Bid Close Date & Time</label><input required type="datetime-local" className="input" value={f.forcedCloseTime} onChange={set('forcedCloseTime')} /></div>
        <div><label className="label">Pickup / Service Date</label><input required type="datetime-local" className="input" value={f.pickupDate} onChange={set('pickupDate')} /></div>
      </section>
      <section className="rounded border border-indigo-100 bg-indigo-50/50 p-3 sm:p-4">
        <h2 className="mb-3 text-sm font-semibold text-indigo-900">British Auction Configuration</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div><label className="label">Trigger Window X (minutes)</label><input required type="number" inputMode="numeric" min={1} className="input" value={f.triggerWindowMinutes} onChange={set('triggerWindowMinutes')} /></div>
          <div><label className="label">Extension Duration Y (minutes)</label><input required type="number" inputMode="numeric" min={1} className="input" value={f.extensionMinutes} onChange={set('extensionMinutes')} /></div>
          <div><label className="label">Extension Trigger</label>
            <select className="input" value={f.triggerType} onChange={set('triggerType')}>
              {(Object.keys(triggerLabel) as TriggerType[]).map((t) => <option key={t} value={t}>{triggerLabel[t]}</option>)}
            </select></div>
        </div>
        <p className="mt-3 text-xs text-slate-600">If the trigger fires in the last {f.triggerWindowMinutes} min before the (current) close, the close extends by {f.extensionMinutes} min — never beyond the forced close.</p>
      </section>
      {[...clientErrors, err].filter(Boolean).map((m) => <p key={m} className="text-sm text-red-600">{m}</p>)}
      <button className="btn w-full sm:w-auto" disabled={clientErrors.length > 0}>Create RFQ</button>
    </form>
  );
}
