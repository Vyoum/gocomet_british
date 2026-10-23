import { describe, expect, it } from 'vitest';
import { bidSchema, rfqSchema } from '../src/schemas';
import { fromMinor, toMinor } from '../src/lib/money';

const future = new Date(Date.now() + 864e5).toISOString();
const bid = { supplierId: 's1', freightCharges: 1000.5, originCharges: '150.25', destinationCharges: 0.1, transitTimeDays: 5, quoteValidUntil: future };
const rfq = {
  referenceId: 'R1', name: 'n', bidStartTime: '2026-10-22T10:00:00Z', bidCloseTime: '2026-10-22T18:00:00Z',
  forcedCloseTime: '2026-10-22T18:30:00Z', pickupDate: '2026-10-30T00:00:00Z', triggerWindowMinutes: '10', extensionMinutes: 5, triggerType: 'L1_CHANGE',
};

describe('money', () => {
  it('converts decimals to integer minor units without float drift', () => {
    expect(toMinor(0.1) + toMinor(0.2)).toBe(30);
    expect(toMinor(1150.75)).toBe(115075);
    expect(fromMinor(115075)).toBe(1150.75);
  });
  it('bid schema stores charges as minor units', () => {
    const b = bidSchema.parse(bid);
    expect([b.freightCharges, b.originCharges, b.destinationCharges]).toEqual([100050, 15025, 10]);
  });
  it('rejects more than 2 decimal places and negatives', () => {
    expect(bidSchema.safeParse({ ...bid, freightCharges: 1.005 }).success).toBe(false);
    expect(bidSchema.safeParse({ ...bid, freightCharges: -1 }).success).toBe(false);
  });
  it('rejects total <= 0', () => {
    expect(bidSchema.safeParse({ ...bid, freightCharges: 0, originCharges: 0, destinationCharges: 0 }).success).toBe(false);
  });
});

describe('strict parsing', () => {
  it('accepts valid RFQ incl. non-empty numeric strings', () => {
    expect(rfqSchema.parse(rfq).triggerWindowMinutes).toBe(10);
  });
  it.each(['', null, '  ', 'abc', true])('rejects number value %j', (v) => {
    expect(bidSchema.safeParse({ ...bid, freightCharges: v }).success).toBe(false);
    expect(rfqSchema.safeParse({ ...rfq, triggerWindowMinutes: v }).success).toBe(false);
  });
  it.each(['', null, 'not-a-date'])('rejects date value %j', (v) => {
    expect(rfqSchema.safeParse({ ...rfq, bidStartTime: v }).success).toBe(false);
    expect(bidSchema.safeParse({ ...bid, quoteValidUntil: v }).success).toBe(false);
  });
  it('rejects unknown trigger type', () => {
    expect(rfqSchema.safeParse({ ...rfq, triggerType: 'NOPE' }).success).toBe(false);
  });
});
