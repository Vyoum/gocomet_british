/**
 * Pure British Auction logic (no DB) — unit tested in tests/auction.test.ts.
 */
export type TriggerType = (typeof TRIGGER_TYPES)[number];
export const TRIGGER_TYPES = ['BID_RECEIVED', 'ANY_RANK_CHANGE', 'L1_CHANGE'] as const;
export type AuctionStatus = 'UPCOMING' | 'ACTIVE' | 'CLOSED' | 'FORCE_CLOSED';

export interface BidLike {
  supplierId: string;
  totalPrice: number;
  createdAt: Date;
}

export interface AuctionTimes {
  bidStartTime: Date;
  currentCloseTime: Date;
  forcedCloseTime: Date;
}

const MIN = 60_000;

/** Only each supplier's latest bid counts. Rank by total asc; ties -> earlier bid wins. */
export function rankBids<T extends BidLike>(bids: T[]): (T & { rank: number })[] {
  const latest = new Map<string, T>();
  for (const b of bids) {
    const cur = latest.get(b.supplierId);
    if (!cur || b.createdAt.getTime() >= cur.createdAt.getTime()) latest.set(b.supplierId, b);
  }
  return [...latest.values()]
    .sort((a, b) => a.totalPrice - b.totalPrice || a.createdAt.getTime() - b.createdAt.getTime())
    .map((b, i) => ({ ...b, rank: i + 1 }));
}

/** Supplier ids in rank order. */
export function rankingOrder(bids: BidLike[]): string[] {
  return rankBids(bids).map((b) => b.supplierId);
}

export function getStatus(a: AuctionTimes, now: Date): AuctionStatus {
  if (now < a.bidStartTime) return 'UPCOMING';
  if (now < a.currentCloseTime) return 'ACTIVE';
  return a.currentCloseTime.getTime() >= a.forcedCloseTime.getTime() ? 'FORCE_CLOSED' : 'CLOSED';
}

export function isInTriggerWindow(currentClose: Date, windowMinutes: number, at: Date): boolean {
  const start = currentClose.getTime() - windowMinutes * MIN;
  return at.getTime() >= start && at.getTime() < currentClose.getTime();
}

export interface ExtensionInput {
  triggerType: TriggerType;
  triggerWindowMinutes: number;
  extensionMinutes: number;
  currentCloseTime: Date;
  forcedCloseTime: Date;
  bidTime: Date;
  rankingBefore: string[]; // supplier ids, rank order, before the new bid
  rankingAfter: string[]; // after the new bid
  supplierName?: string;
}

export interface ExtensionDecision {
  extend: boolean;
  newCloseTime: Date;
  cappedAtForcedClose: boolean;
  reason: string;
}

/** Decide whether a newly accepted bid extends the auction. Measured against the CURRENT (possibly already extended) close. */
export function evaluateExtension(i: ExtensionInput): ExtensionDecision {
  const no = (reason: string): ExtensionDecision => ({ extend: false, newCloseTime: i.currentCloseTime, cappedAtForcedClose: false, reason });
  if (!isInTriggerWindow(i.currentCloseTime, i.triggerWindowMinutes, i.bidTime)) return no('Bid outside trigger window');
  if (i.currentCloseTime.getTime() >= i.forcedCloseTime.getTime()) return no('Already at forced close time');

  let why: string | null = null;
  const who = i.supplierName ?? 'a supplier';
  if (i.triggerType === 'BID_RECEIVED') {
    why = `Bid received from ${who} within last ${i.triggerWindowMinutes} min`;
  } else if (i.triggerType === 'ANY_RANK_CHANGE') {
    const changed = i.rankingBefore.length !== i.rankingAfter.length || i.rankingBefore.some((s, idx) => s !== i.rankingAfter[idx]);
    if (changed) why = `Supplier ranking changed (bid by ${who}) within last ${i.triggerWindowMinutes} min`;
  } else if (i.triggerType === 'L1_CHANGE') {
    if (i.rankingAfter[0] !== i.rankingBefore[0]) why = `New L1 (lowest bidder): ${who} within last ${i.triggerWindowMinutes} min`;
  }
  if (!why) return no(`Trigger ${i.triggerType} not met`);

  const proposed = i.currentCloseTime.getTime() + i.extensionMinutes * MIN;
  const capped = proposed >= i.forcedCloseTime.getTime();
  const newCloseTime = new Date(Math.min(proposed, i.forcedCloseTime.getTime()));
  return {
    extend: true,
    newCloseTime,
    cappedAtForcedClose: capped,
    reason: `${why}; extended by ${i.extensionMinutes} min${capped ? ' (capped at forced close time)' : ''}`,
  };
}

/** Validation for RFQ timing config. Returns list of error messages. */
export function validateRfqTimes(t: { bidStartTime: Date; bidCloseTime: Date; forcedCloseTime: Date; triggerWindowMinutes: number; extensionMinutes: number }): string[] {
  const e: string[] = [];
  if (!(t.bidCloseTime > t.bidStartTime)) e.push('Bid close time must be after bid start time');
  if (!(t.forcedCloseTime > t.bidCloseTime)) e.push('Forced close time must be after bid close time');
  if (!(t.triggerWindowMinutes > 0)) e.push('Trigger window X must be > 0');
  if (!(t.extensionMinutes > 0)) e.push('Extension duration Y must be > 0');
  return e;
}
