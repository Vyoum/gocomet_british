-- Convert money columns from REAL (decimal) to INTEGER minor units (x100).
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bid" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "freightCharges" INTEGER NOT NULL,
    "originCharges" INTEGER NOT NULL,
    "destinationCharges" INTEGER NOT NULL,
    "totalPrice" INTEGER NOT NULL,
    "transitTimeDays" INTEGER NOT NULL,
    "quoteValidUntil" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bid_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Bid_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Bid" ("createdAt", "destinationCharges", "freightCharges", "id", "originCharges", "quoteValidUntil", "rfqId", "supplierId", "totalPrice", "transitTimeDays") SELECT "createdAt", CAST(ROUND("destinationCharges" * 100) AS INTEGER), CAST(ROUND("freightCharges" * 100) AS INTEGER), "id", CAST(ROUND("originCharges" * 100) AS INTEGER), "quoteValidUntil", "rfqId", "supplierId", CAST(ROUND("totalPrice" * 100) AS INTEGER), "transitTimeDays" FROM "Bid";
DROP TABLE "Bid";
ALTER TABLE "new_Bid" RENAME TO "Bid";
CREATE INDEX "Bid_rfqId_supplierId_createdAt_idx" ON "Bid"("rfqId", "supplierId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

