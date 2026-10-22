import { describe, expect, it } from 'vitest';
import { evaluateExtension, getStatus, isInTriggerWindow, rankBids, rankingOrder, validateRfqTimes } from '../src/lib/auction';
import { KeyedMutex } from '../src/lib/mutex';

const T = (hhmm: string) => new Date(`2026-10-22T${hhmm}:00Z`);
const close = T('18:00');
const forced = T('18:30');
const base = { triggerWindowMinutes: 10, extensionMinutes: 5, currentCloseTime: close, forcedCloseTime: forced };

describe('ranking', () => {
  it('uses latest bid per supplier, sorted by total asc', () => {
    const r = rankBids([
      { supplierId: 'A', totalPrice: 100, createdAt: T('17:00') },
      { supplierId: 'B', totalPrice: 90, createdAt: T('17:01') },
      { supplierId: 'A', totalPrice: 80, createdAt: T('17:02') },
    ]);
    expect(r.map((b) => [b.supplierId, b.rank, b.totalPrice])).toEqual([['A', 1, 80], ['B', 2, 90]]);
  });
  it('breaks ties by earliest bid', () => {
    expect(rankingOrder([
      { supplierId: 'B', totalPrice: 50, createdAt: T('17:05') },
      { supplierId: 'A', totalPrice: 50, createdAt: T('17:01') },
    ])).toEqual(['A', 'B']);
  });
});

describe('trigger window', () => {
  it('is [close - X, close)', () => {
    expect(isInTriggerWindow(close, 10, T('17:49'))).toBe(false);
    expect(isInTriggerWindow(close, 10, T('17:50'))).toBe(true);
    expect(isInTriggerWindow(close, 10, T('17:59'))).toBe(true);
    expect(isInTriggerWindow(close, 10, T('18:00'))).toBe(false);
  });
});

describe('BID_RECEIVED', () => {
  it('extends on any bid in window', () => {
    const d = evaluateExtension({ ...base, triggerType: 'BID_RECEIVED', bidTime: T('17:55'), rankingBefore: ['A'], rankingAfter: ['A', 'B'] });
    expect(d.extend).toBe(true);
    expect(d.newCloseTime).toEqual(T('18:05'));
  });
  it('extends even with no rank change', () => {
    const d = evaluateExtension({ ...base, triggerType: 'BID_RECEIVED', bidTime: T('17:55'), rankingBefore: ['A', 'B'], rankingAfter: ['A', 'B'] });
    expect(d.extend).toBe(true);
  });
  it('does not extend outside window', () => {
    const d = evaluateExtension({ ...base, triggerType: 'BID_RECEIVED', bidTime: T('17:40'), rankingBefore: [], rankingAfter: ['A'] });
    expect(d.extend).toBe(false);
  });
  it('uses the already-extended close time', () => {
    const d = evaluateExtension({ ...base, currentCloseTime: T('18:05'), triggerType: 'BID_RECEIVED', bidTime: T('18:02'), rankingBefore: ['A'], rankingAfter: ['A'] });
    expect(d.newCloseTime).toEqual(T('18:10'));
  });
});

describe('ANY_RANK_CHANGE', () => {
  it('extends when order changes', () => {
    const d = evaluateExtension({ ...base, triggerType: 'ANY_RANK_CHANGE', bidTime: T('17:55'), rankingBefore: ['A', 'B', 'C'], rankingAfter: ['A', 'C', 'B'] });
    expect(d.extend).toBe(true);
  });
  it('extends when a new supplier enters ranking', () => {
    const d = evaluateExtension({ ...base, triggerType: 'ANY_RANK_CHANGE', bidTime: T('17:55'), rankingBefore: ['A'], rankingAfter: ['A', 'B'] });
    expect(d.extend).toBe(true);
  });
  it('does not extend when ranks unchanged', () => {
    const d = evaluateExtension({ ...base, triggerType: 'ANY_RANK_CHANGE', bidTime: T('17:55'), rankingBefore: ['A', 'B'], rankingAfter: ['A', 'B'] });
    expect(d.extend).toBe(false);
  });
});

describe('L1_CHANGE', () => {
  it('extends only when L1 changes', () => {
    expect(evaluateExtension({ ...base, triggerType: 'L1_CHANGE', bidTime: T('17:55'), rankingBefore: ['A', 'B'], rankingAfter: ['B', 'A'] }).extend).toBe(true);
  });
  it('does not extend on lower-rank change', () => {
    expect(evaluateExtension({ ...base, triggerType: 'L1_CHANGE', bidTime: T('17:55'), rankingBefore: ['A', 'B', 'C'], rankingAfter: ['A', 'C', 'B'] }).extend).toBe(false);
  });
  it('first ever bid in window counts as L1 change', () => {
    expect(evaluateExtension({ ...base, triggerType: 'L1_CHANGE', bidTime: T('17:55'), rankingBefore: [], rankingAfter: ['A'] }).extend).toBe(true);
  });
});

describe('forced close cap', () => {
  it('caps extension at forced close', () => {
    const d = evaluateExtension({ ...base, currentCloseTime: T('18:28'), triggerType: 'BID_RECEIVED', bidTime: T('18:27'), rankingBefore: [], rankingAfter: ['A'] });
    expect(d.extend).toBe(true);
    expect(d.newCloseTime).toEqual(forced);
    expect(d.cappedAtForcedClose).toBe(true);
  });
  it('no extension once current close equals forced close', () => {
    const d = evaluateExtension({ ...base, currentCloseTime: forced, triggerType: 'BID_RECEIVED', bidTime: T('18:29'), rankingBefore: [], rankingAfter: ['A'] });
    expect(d.extend).toBe(false);
  });
});

describe('status & validation', () => {
  const a = { bidStartTime: T('17:00'), currentCloseTime: close, forcedCloseTime: forced };
  it('computes statuses', () => {
    expect(getStatus(a, T('16:59'))).toBe('UPCOMING');
    expect(getStatus(a, T('17:30'))).toBe('ACTIVE');
    expect(getStatus(a, T('18:00'))).toBe('CLOSED');
    expect(getStatus({ ...a, currentCloseTime: forced }, T('18:30'))).toBe('FORCE_CLOSED');
  });
  it('validates forced > close > start', () => {
    expect(validateRfqTimes({ bidStartTime: T('17:00'), bidCloseTime: close, forcedCloseTime: forced, triggerWindowMinutes: 10, extensionMinutes: 5 })).toEqual([]);
    expect(validateRfqTimes({ bidStartTime: T('17:00'), bidCloseTime: close, forcedCloseTime: close, triggerWindowMinutes: 10, extensionMinutes: 5 })).toHaveLength(1);
    expect(validateRfqTimes({ bidStartTime: T('18:00'), bidCloseTime: T('17:00'), forcedCloseTime: forced, triggerWindowMinutes: 0, extensionMinutes: 5 })).toHaveLength(2);
  });
});

describe('KeyedMutex', () => {
  it('serializes work per key', async () => {
    const m = new KeyedMutex();
    const log: string[] = [];
    const job = (id: string, ms: number) => m.run('rfq', async () => { log.push(`s${id}`); await new Promise((r) => setTimeout(r, ms)); log.push(`e${id}`); });
    await Promise.all([job('1', 20), job('2', 1), job('3', 5)]);
    expect(log).toEqual(['s1', 'e1', 's2', 'e2', 's3', 'e3']);
  });
});
