const BASE = import.meta.env.VITE_API_URL ?? '/api';
export type Status = 'UPCOMING' | 'ACTIVE' | 'CLOSED' | 'FORCE_CLOSED';
export type TriggerType = 'BID_RECEIVED' | 'ANY_RANK_CHANGE' | 'L1_CHANGE';
export interface Supplier { id: string; name: string }
export interface RfqSummary {
  id: string; referenceId: string; name: string; bidStartTime: string; bidCloseTime: string; currentCloseTime: string;
  forcedCloseTime: string; pickupDate: string; triggerWindowMinutes: number; extensionMinutes: number; triggerType: TriggerType;
  extensionCount: number; status: Status; lowestBid: number | null; bidCount: number; supplierCount: number;
}
export interface Bid {
  id: string; supplierId: string; supplierName: string; freightCharges: number; originCharges: number; destinationCharges: number;
  totalPrice: number; transitTimeDays: number; quoteValidUntil: string; createdAt: string; rank?: number; label?: string;
}
export interface Activity { id: string; type: string; message: string; createdAt: string }
export interface RfqDetails extends Omit<RfqSummary, 'lowestBid' | 'bidCount' | 'supplierCount'> {
  serverTime: string; rankedBids: Bid[]; allBids: Bid[]; activity: Activity[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...init });
  const j = await r.json();
  if (!r.ok) throw new Error(j.details && Array.isArray(j.details) && j.details[0]?.message ? `${j.error}: ${j.details.map((d: any) => `${d.path?.join('.')} ${d.message}`).join(', ')}` : j.error);
  return j;
}
export const api = {
  suppliers: () => req<Supplier[]>('/suppliers'),
  rfqs: () => req<RfqSummary[]>('/rfqs'),
  rfq: (id: string) => req<RfqDetails>(`/rfqs/${id}`),
  createRfq: (b: unknown) => req<{ id: string }>('/rfqs', { method: 'POST', body: JSON.stringify(b) }),
  placeBid: (id: string, b: unknown) => req<{ rank: number; extension: { extend: boolean; reason: string } }>(`/rfqs/${id}/bids`, { method: 'POST', body: JSON.stringify(b) }),
};

/** Subscribe to server-sent events; falls back to 5s polling if SSE fails. */
export function subscribe(onChange: (rfqId: string) => void): () => void {
  let poll: number | undefined;
  const es = new EventSource(BASE + '/events');
  es.onmessage = (e) => onChange(JSON.parse(e.data).rfqId);
  es.onerror = () => { if (!poll) poll = window.setInterval(() => onChange('*'), 5000); };
  return () => { es.close(); if (poll) clearInterval(poll); };
}
