-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bidStartTime" TIMESTAMP(3) NOT NULL,
    "bidCloseTime" TIMESTAMP(3) NOT NULL,
    "currentCloseTime" TIMESTAMP(3) NOT NULL,
    "forcedCloseTime" TIMESTAMP(3) NOT NULL,
    "pickupDate" TIMESTAMP(3) NOT NULL,
    "triggerWindowMinutes" INTEGER NOT NULL,
    "extensionMinutes" INTEGER NOT NULL,
    "triggerType" TEXT NOT NULL,
    "extensionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "freightCharges" INTEGER NOT NULL,
    "originCharges" INTEGER NOT NULL,
    "destinationCharges" INTEGER NOT NULL,
    "totalPrice" INTEGER NOT NULL,
    "transitTimeDays" INTEGER NOT NULL,
    "quoteValidUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Rfq_referenceId_key" ON "Rfq"("referenceId");

-- CreateIndex
CREATE INDEX "Rfq_currentCloseTime_idx" ON "Rfq"("currentCloseTime");

-- CreateIndex
CREATE INDEX "Bid_rfqId_supplierId_createdAt_idx" ON "Bid"("rfqId", "supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_rfqId_createdAt_idx" ON "ActivityLog"("rfqId", "createdAt");

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

