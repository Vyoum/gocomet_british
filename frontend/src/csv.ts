import type { RfqDetails } from './api';

const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function bidsCsv(r: RfqDetails): string {
  const ranked = new Map(r.rankedBids.map((b) => [b.id, b]));
  const head = ['RFQ', 'Rank', 'Carrier', 'Freight', 'Origin', 'Destination', 'Total', 'Transit days', 'Valid until', 'Bid at', 'Latest (ranked)'];
  // Ranked (latest) bids first in rank order, then superseded bids oldest-first.
  const rest = r.allBids.filter((b) => !ranked.has(b.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rows = [...r.rankedBids, ...rest].map((b) => [r.referenceId, ranked.get(b.id)?.label ?? '', b.supplierName, b.freightCharges, b.originCharges,
    b.destinationCharges, b.totalPrice, b.transitTimeDays, b.quoteValidUntil, b.createdAt, ranked.has(b.id) ? 'yes' : 'no']);
  return [head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
export function downloadBidsCsv(r: RfqDetails) {
  const url = URL.createObjectURL(new Blob(['\ufeff' + bidsCsv(r)], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${r.referenceId}-bids.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
