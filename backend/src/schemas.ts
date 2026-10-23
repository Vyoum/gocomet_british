import { z } from 'zod';
import { TRIGGER_TYPES } from './lib/auction';
import { toMinor } from './lib/money';

/** Number from a JSON number or a non-empty numeric string. Rejects "", null, booleans, NaN. */
const strictNumber = z
  .union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/, 'Expected a number')])
  .transform(Number)
  .pipe(z.number().finite());

/** Date from a non-empty ISO string or epoch ms. Rejects "", null, invalid dates. */
const strictDate = z
  .union([z.string().trim().min(1, 'Expected a date'), z.number()])
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');

const posInt = strictNumber.pipe(z.number().int().positive());
/** Decimal amount (max 2 dp) -> integer minor units. */
const money = strictNumber
  .pipe(z.number().min(0).refine((n) => Math.abs(toMinor(n) - n * 100) < 1e-6, 'At most 2 decimal places'))
  .transform(toMinor);

export const rfqSchema = z.object({
  referenceId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  bidStartTime: strictDate,
  bidCloseTime: strictDate,
  forcedCloseTime: strictDate,
  pickupDate: strictDate,
  triggerWindowMinutes: posInt,
  extensionMinutes: posInt,
  triggerType: z.enum(TRIGGER_TYPES),
});

export const bidSchema = z
  .object({
    supplierId: z.string().min(1),
    freightCharges: money,
    originCharges: money,
    destinationCharges: money,
    transitTimeDays: posInt,
    quoteValidUntil: strictDate,
  })
  .refine((b) => b.freightCharges + b.originCharges + b.destinationCharges > 0, {
    message: 'Total price must be greater than 0',
    path: ['freightCharges'],
  });
