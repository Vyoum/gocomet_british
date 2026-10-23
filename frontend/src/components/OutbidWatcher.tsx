import { useEffect, useRef } from 'react';
import { api, subscribe } from '../api';
import { useRole } from '../role';
import { toast } from './Toasts';

/** Supplier role only: watches live (SSE) updates and toasts when another supplier's bid pushes you down a rank. */
export default function OutbidWatcher() {
  const role = useRole();
  const name = role.kind === 'supplier' ? role.name : null;
  const ranks = useRef<Map<string, number | null> | null>(null);
  useEffect(() => {
    if (!name) return;
    ranks.current = null;
    let alive = true, busy = false, again = false;
    const check = async () => {
      if (busy) { again = true; return; }
      busy = true;
      try {
        const list = await api.rfqs();
        if (!alive) return;
        const prev = ranks.current;
        const next = new Map(list.map((r) => [r.id, r.myRank ?? null]));
        if (prev) for (const r of list) {
          const was = prev.get(r.id), now = r.myRank ?? null;
          if (was != null && now != null && now > was)
            toast('warn', `You were outbid on ${r.referenceId} — now L${now}${was === 1 ? ' (lost L1)' : ''}`, { to: `/rfq/${r.id}`, label: 'View RFQ' }, 8000);
        }
        ranks.current = next;
      } catch { /* ignore transient errors */ } finally { busy = false; if (again && alive) { again = false; check(); } }
    };
    const unsub = subscribe(() => check());
    check();
    return () => { alive = false; unsub(); };
  }, [name]);
  return null;
}
