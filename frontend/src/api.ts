import { roleHeaders } from './role';

/** Backend origin (VITE_API_URL, e.g. the Render URL); '' = same origin (Vite dev proxy). */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '') + '/api';
export type Status = 'UPCOMING' | 'ACTIVE' | 'CLOSED' | 'FORCE_CLOSED';
export type TriggerType = 'BID_RECEIVED' | 'ANY_RANK_CHANGE' | 'L1_CHANGE';
export interface Supplier { id: string; name: string }
export interface RfqSummary {
  id: string; referenceId: string; name: string; bidStartTime: string; bidCloseTime: string; currentCloseTime: string;
  forcedCloseTime: string; pickupDate: string; triggerWindowMinutes: number; extensionMinutes: number; triggerType: TriggerType;
  extensionCount: number; status: Status; lowestBid: number | null; bidCount: number; supplierCount: number;
  topRanks: TopRank[];
  /** Only present for X-Role: supplier — the viewing supplier's rank, null if not bid. */
  myRank?: number | null;
}
export interface TopRank { rank: number; carrierName: string; total: number }
export interface Bid {
  id: string; supplierId: string; supplierName: string; freightCharges: number; originCharges: number; destinationCharges: number;
  totalPrice: number; transitTimeDays: number; quoteValidUntil: string; createdAt: string; rank?: number; label?: string;
}
export interface BidResult { replayed?: boolean; rank: number; extension: { extend: boolean; cappedAtForcedClose: boolean; reason: string } }
export interface Activity { id: string; type: string; message: string; createdAt: string }
export interface RfqDetails extends Omit<RfqSummary, 'lowestBid' | 'bidCount' | 'supplierCount' | 'topRanks'> {
  serverTime: string; rankedBids: Bid[]; allBids: Bid[]; activity: Activity[];
}

/** Server clock minus client clock (ms); countdowns use this so a skewed client clock doesn't matter. */
let clockOffset = 0;
export const serverNow = () => Date.now() + clockOffset;
const syncClock = (serverTime?: string) => { if (serverTime) clockOffset = new Date(serverTime).getTime() - Date.now(); };

export class HttpError extends Error { constructor(message: string, public status: number) { super(message); } }

async function req<T>(path: string, init?: RequestInit, onHeaders?: (h: Headers) => void): Promise<T> {
  const r = await fetch(BASE + path, { ...init, headers: { 'Content-Type': 'application/json', ...roleHeaders(), ...(init?.headers as Record<string, string> | undefined) } });
  const j = await r.json();
  onHeaders?.(r.headers);
  if (!r.ok) throw new HttpError(j.details && Array.isArray(j.details) && j.details[0]?.message ? `${j.error}: ${j.details.map((d: any) => `${d.path?.join('.')} ${d.message}`).join(', ')}` : j.error, r.status);
  return j;
}
export const api = {
  suppliers: () => req<Supplier[]>('/suppliers'),
  ensureSupplier: (name: string) => req<Supplier>('/suppliers', { method: 'POST', body: JSON.stringify({ name }) }),
  rfqs: () => req<{ serverTime: string; rfqs: RfqSummary[] }>('/rfqs').then((r) => { syncClock(r.serverTime); return r.rfqs; }),
  rfq: (id: string) => req<RfqDetails>(`/rfqs/${id}`).then((r) => { syncClock(r.serverTime); return r; }),
  createRfq: (b: unknown) => req<{ id: string }>('/rfqs', { method: 'POST', body: JSON.stringify(b) }),
  /** Same Idempotency-Key on every retry: the server replays the original result instead of creating a second bid. */
  placeBid: async (id: string, b: unknown, idempotencyKey: string, retries = 2) => {
    for (let attempt = 0; ; attempt++) {
      try {
        let replayed = false;
        const res = await req<BidResult>(`/rfqs/${id}/bids`, { method: 'POST', body: JSON.stringify(b), headers: { 'Idempotency-Key': idempotencyKey } },
          (h) => { replayed = h.get('Idempotent-Replayed') === 'true'; });
        return { ...res, replayed };
      } catch (e) {
        // Retry only transport failures / 5xx (outcome unknown); 4xx are final answers.
        const retryable = !(e instanceof HttpError) || e.status >= 500;
        if (!retryable || attempt >= retries) throw e;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  },
};

/** Subscribe to server-sent events; falls back to 5s polling if SSE fails. */
export function subscribe(onChange: (rfqId: string) => void): () => void {
  let poll: number | undefined;
  const es = new EventSource(BASE + '/events');
  es.onopen = () => onChange('*'); // (re)connected: refetch anything missed while disconnected
  es.onmessage = (e) => onChange(JSON.parse(e.data).rfqId);
  es.onerror = () => { if (!poll) poll = window.setInterval(() => onChange('*'), 5000); };
  return () => { es.close(); if (poll) clearInterval(poll); };
}
