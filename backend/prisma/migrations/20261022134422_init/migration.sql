-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "referenceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bidStartTime" DATETIME NOT NULL,
    "bidCloseTime" DATETIME NOT NULL,
    "currentCloseTime" DATETIME NOT NULL,
    "forcedCloseTime" DATETIME NOT NULL,
    "pickupDate" DATETIME NOT NULL,
    "triggerWindowMinutes" INTEGER NOT NULL,
    "extensionMinutes" INTEGER NOT NULL,
    "triggerType" TEXT NOT NULL,
    "extensionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "freightCharges" REAL NOT NULL,
    "originCharges" REAL NOT NULL,
    "destinationCharges" REAL NOT NULL,
    "totalPrice" REAL NOT NULL,
    "transitTimeDays" INTEGER NOT NULL,
    "quoteValidUntil" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bid_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Bid_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
