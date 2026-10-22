import { prisma } from './lib/db';
import { KeyedMutex } from './lib/mutex';
import { HttpError } from './lib/errors';
import { emitRfqUpdate } from './lib/events';
import { evaluateExtension, getStatus, rankBids, rankingOrder, TriggerType, validateRfqTimes } from './lib/auction';

const mutex = new KeyedMutex();

export interface CreateRfqInput {
  referenceId: string;
  name: string;
  bidStartTime: Date;
  bidCloseTime: Date;
  forcedCloseTime: Date;
  pickupDate: Date;
  triggerWindowMinutes: number;
  extensionMinutes: number;
  triggerType: TriggerType;
}

export async function createRfq(input: CreateRfqInput) {
  const errors = validateRfqTimes(input);
  if (errors.length) throw new HttpError(400, errors.join('; '), errors);
  const exists = await prisma.rfq.findUnique({ where: { referenceId: input.referenceId } });
  if (exists) throw new HttpError(409, `Reference ID ${input.referenceId} already exists`);
  const rfq = await prisma.rfq.create({
    data: {
      ...input,
      currentCloseTime: input.bidCloseTime,
      activity: {
        create: {
          type: 'RFQ_CREATED',
          message: `RFQ created. Trigger: ${input.triggerType}, X=${input.triggerWindowMinutes} min, Y=${input.extensionMinutes} min`,
        },
      },
    },
  });
  emitRfqUpdate(rfq.id);
  return rfq;
}

export interface PlaceBidInput {
  supplierId: string;
  freightCharges: number;
  originCharges: number;
  destinationCharges: number;
  transitTimeDays: number;
  quoteValidUntil: Date;
}

/**
 * Place a bid. Serialized per RFQ via in-process mutex AND executed inside a DB transaction,
 * so the read-rank-extend-write sequence is atomic with respect to other bids on the same RFQ.
 */
export async function placeBid(rfqId: string, input: PlaceBidInput, now: () => Date = () => new Date()) {
  const result = await mutex.run(rfqId, () =>
    prisma.$transaction(async (tx) => {
      const rfq = await tx.rfq.findUnique({ where: { id: rfqId } });
      if (!rfq) throw new HttpError(404, 'RFQ not found');
      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier) throw new HttpError(400, 'Unknown supplier');

      const at = now();
      const status = getStatus(rfq, at);
      if (status !== 'ACTIVE') throw new HttpError(409, `Bidding not open (status: ${status})`);

      const totalPrice = round2(input.freightCharges + input.originCharges + input.destinationCharges);
      if (totalPrice <= 0) throw new HttpError(400, 'Total price must be > 0');

      const existing = await tx.bid.findMany({ where: { rfqId }, select: { supplierId: true, totalPrice: true, createdAt: true } });
      const prevOwn = rankBids(existing).find((b) => b.supplierId === supplier.id);
      if (prevOwn && totalPrice >= prevOwn.totalPrice)
        throw new HttpError(400, `Re-bid must be lower than your previous bid of ${prevOwn.totalPrice}`);

      const before = rankingOrder(existing);
      const bid = await tx.bid.create({ data: { rfqId, ...input, totalPrice, createdAt: at } });
      const after = rankingOrder([...existing, { supplierId: supplier.id, totalPrice, createdAt: at }]);
      const rank = after.indexOf(supplier.id) + 1;

      await tx.activityLog.create({
        data: {
          rfqId,
          type: 'BID_PLACED',
          message: `${supplier.name} ${prevOwn ? 're-bid' : 'bid'} ${totalPrice.toFixed(2)} (now L${rank})`,
          metadata: JSON.stringify({ bidId: bid.id, totalPrice, rank }),
          createdAt: at,
        },
      });

      const decision = evaluateExtension({
        triggerType: rfq.triggerType as TriggerType,
        triggerWindowMinutes: rfq.triggerWindowMinutes,
        extensionMinutes: rfq.extensionMinutes,
        currentCloseTime: rfq.currentCloseTime,
        forcedCloseTime: rfq.forcedCloseTime,
        bidTime: at,
        rankingBefore: before,
        rankingAfter: after,
        supplierName: supplier.name,
      });

      if (decision.extend) {
        await tx.rfq.update({
          where: { id: rfqId },
          data: { currentCloseTime: decision.newCloseTime, extensionCount: { increment: 1 } },
        });
        await tx.activityLog.create({
          data: {
            rfqId,
            type: 'EXTENDED',
            message: `Close time extended ${fmt(rfq.currentCloseTime)} → ${fmt(decision.newCloseTime)}. Reason: ${decision.reason}`,
            metadata: JSON.stringify({ from: rfq.currentCloseTime, to: decision.newCloseTime, capped: decision.cappedAtForcedClose }),
            createdAt: new Date(at.getTime() + 1),
          },
        });
      }
      return { bid, rank, extension: decision };
    }),
  );
  emitRfqUpdate(rfqId);
  return result;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';

export async function listRfqs(now = new Date()) {
  const rfqs = await prisma.rfq.findMany({ include: { bids: true }, orderBy: { bidStartTime: 'desc' } });
  return rfqs.map(({ bids, ...r }) => {
    const ranked = rankBids(bids);
    return {
      ...r,
      status: getStatus(r, now),
      lowestBid: ranked[0]?.totalPrice ?? null,
      bidCount: bids.length,
      supplierCount: ranked.length,
    };
  });
}

export async function getRfqDetails(id: string, now = new Date()) {
  const rfq = await prisma.rfq.findUnique({
    where: { id },
    include: { bids: { include: { supplier: true } }, activity: { orderBy: { createdAt: 'desc' } } },
  });
  if (!rfq) throw new HttpError(404, 'RFQ not found');
  const { bids, activity, ...r } = rfq;
  const ranked = rankBids(bids).map((b) => ({ ...b, supplierName: b.supplier.name, label: `L${b.rank}` }));
  return {
    ...r,
    status: getStatus(r, now),
    serverTime: now,
    rankedBids: ranked,
    allBids: bids.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((b) => ({ ...b, supplierName: b.supplier.name })),
    activity,
  };
}
