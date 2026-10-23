import { FormEvent, useEffect, useState } from 'react';
import { api, Supplier } from '../api';
import { setRole, useRole } from '../role';
import InfoTip from './InfoTip';

/** Header control for the demo role switch (no auth). */
export default function RoleSwitcher() {
  const role = useRole();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const load = () => api.suppliers().then(setSuppliers).catch(() => {});
  useEffect(() => { load(); }, []);
  const value = role.kind === 'supplier' ? 's:' + role.name : role.kind;
  const names = suppliers.map((s) => s.name);
  if (role.kind === 'supplier' && !names.some((n) => n.toLowerCase() === role.name.toLowerCase())) names.push(role.name);

  function change(v: string) {
    if (v === '__new') { setAdding(true); return; }
    setAdding(false);
    setRole(v === 'buyer' ? { kind: 'buyer' } : v.startsWith('s:') ? { kind: 'supplier', name: v.slice(2) } : { kind: 'open' });
  }
  async function add(e: FormEvent) {
    e.preventDefault(); setErr('');
    try { const s = await api.ensureSupplier(name); await load(); setRole({ kind: 'supplier', name: s.name }); setAdding(false); setName(''); }
    catch (x) { setErr((x as Error).message); }
  }
  return (
    <div className="no-print ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 py-1" data-testid="role-switcher">
      <label htmlFor="role" className="hidden text-xs text-slate-500 sm:inline">Viewing as <span className="rounded bg-amber-100 px-1 text-amber-800">demo</span></label>
      <select id="role" aria-label="Demo role" className="input !w-auto min-h-[40px] max-w-[60vw] truncate py-1 text-sm" value={value} onChange={(e) => change(e.target.value)}>
        <option value="open">Open demo (no role)</option>
        <option value="buyer">Buyer</option>
        <optgroup label="Supplier">
          {names.map((n) => <option key={n} value={'s:' + n}>Supplier: {n}</option>)}
        </optgroup>
        <option value="__new">+ New carrier…</option>
      </select>
      <InfoTip label="Role restrictions (demo, not auth)">Your choice is sent as <code>X-Role</code> / <code>X-Supplier</code> headers. <b>Buyer</b>: can create RFQs; bids are rejected (403). <b>Supplier</b>: cannot create RFQs and may only bid as itself (server returns 403 otherwise); the listing shows your own rank. <b>Open demo</b> sends no headers, so everything is allowed. Headers are trusted as sent — real auth would replace this.</InfoTip>
      {adding && (
        <form onSubmit={add} className="flex w-full items-center gap-2 sm:w-auto">
          <input autoFocus aria-label="New carrier name" placeholder="Carrier name" className="input min-h-[40px] py-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          <button className="btn min-h-[40px] py-1 text-sm">Use</button>
          {err && <span className="text-xs text-red-600">{err}</span>}
        </form>
      )}
    </div>
  );
}
