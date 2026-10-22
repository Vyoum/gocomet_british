import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const MIN = 60_000;

async function main() {
  await prisma.activityLog.deleteMany();
  await prisma.bid.deleteMany();
  await prisma.rfq.deleteMany();
  await prisma.supplier.deleteMany();

  const names = ['BlueDart Logistics', 'Maersk Line', 'DHL Global Forwarding', 'Gati Cargo', 'Safexpress'];
  const s = await Promise.all(names.map((name) => prisma.supplier.create({ data: { name } })));
  const now = Date.now();
  const at = (m: number) => new Date(now + m * MIN);

  const mk = async (referenceId: string, name: string, start: number, close: number, forced: number, triggerType: string, X: number, Y: number) =>
    prisma.rfq.create({
      data: {
        referenceId, name, triggerType, triggerWindowMinutes: X, extensionMinutes: Y,
        bidStartTime: at(start), bidCloseTime: at(close), currentCloseTime: at(close), forcedCloseTime: at(forced), pickupDate: at(60 * 24 * 7),
        activity: { create: { type: 'RFQ_CREATED', message: `RFQ created. Trigger: ${triggerType}, X=${X} min, Y=${Y} min`, createdAt: at(start) } },
      },
    });

  const active = await mk('RFQ-1001', 'Mumbai → Rotterdam 2x40HC', -30, 8, 30, 'BID_RECEIVED', 10, 5);
  await mk('RFQ-1002', 'Delhi → Chennai FTL 20T', -10, 45, 90, 'L1_CHANGE', 10, 5);
  await mk('RFQ-1003', 'Chennai → Singapore LCL', -5, 3, 15, 'ANY_RANK_CHANGE', 5, 3);
  await mk('RFQ-1004', 'Kolkata → Dhaka Air', 60, 180, 240, 'BID_RECEIVED', 15, 10);
  const closed = await mk('RFQ-0999', 'Pune → Bengaluru PTL', -300, -120, -60, 'L1_CHANGE', 10, 5);

  const bid = (rfqId: string, supplierId: string, f: number, o: number, d: number, m: number) =>
    prisma.bid.create({
      data: { rfqId, supplierId, freightCharges: f, originCharges: o, destinationCharges: d, totalPrice: f + o + d, transitTimeDays: 21, quoteValidUntil: at(60 * 24 * 30), createdAt: at(m) },
    });
  await bid(active.id, s[0].id, 2000, 150, 200, -25);
  await bid(active.id, s[1].id, 1900, 120, 180, -20);
  await bid(active.id, s[2].id, 2100, 100, 150, -15);
  await bid(closed.id, s[3].id, 900, 50, 50, -200);
  await bid(closed.id, s[4].id, 850, 60, 40, -150);
  for (const [rfq, msg, m] of [
    [active.id, 'BlueDart Logistics bid 2350.00 (now L1)', -25], [active.id, 'Maersk Line bid 2200.00 (now L1)', -20],
    [active.id, 'DHL Global Forwarding bid 2350.00 (now L3)', -15], [closed.id, 'Gati Cargo bid 1000.00 (now L1)', -200],
    [closed.id, 'Safexpress bid 950.00 (now L1)', -150],
  ] as const)
    await prisma.activityLog.create({ data: { rfqId: rfq, type: 'BID_PLACED', message: msg, createdAt: at(m) } });
  console.log('Seeded', names.length, 'suppliers and 5 RFQs');
}
main().finally(() => prisma.$disconnect());
