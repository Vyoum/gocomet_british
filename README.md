# RFQ System with British Auction

A simplified RFQ (Request for Quotation) platform where carriers bid openly on freight RFQs using **British Auction** rules: automatic time extensions near the close, configurable triggers, and a hard **forced close**.

- `backend/`: Node.js, TypeScript, Express, Prisma (SQLite by default, Postgres-ready), Zod validation, SSE for live updates, Vitest unit tests
- `frontend/`: React, Vite, TypeScript, Tailwind
- `docs/`: [HLD](docs/HLD.md) and [DB schema](docs/SCHEMA.md)

## Quick start (zero setup, SQLite)

Requires Node 18+.

```bash
# 1. Backend
cd backend
cp .env.example .env
npm install
npm run setup          # prisma migrate deploy + generate + seed demo data
npm run dev            # http://localhost:4000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev            # http://localhost:5173  (proxies /api -> :4000)
```

Tests: `cd backend && npm test`

Re-seed at any time with `npm run db:seed`. The seed creates RFQs relative to *now*, so there are always auctions that are active, already in their trigger window, upcoming, and closed.

### Switching to PostgreSQL
1. In `backend/prisma/schema.prisma`, set `provider = "postgresql"`.
2. In `.env`, set `DATABASE_URL="postgresql://user:pass@localhost:5432/rfq"`.
3. Delete `backend/prisma/migrations` (it's SQLite-specific), then run `npx prisma migrate dev --name init && npm run db:seed`.

The schema avoids anything that only works in SQLite. Enums are stored as strings and metadata as JSON text, so no other changes are needed.

## Using the app
1. **Listing** (`/`): every auction with its name/ID, current lowest bid, current close time (and how many extensions), a live countdown, forced close, and status (Upcoming / Active / Closed / Force Closed).
2. **New RFQ** (`/new`): name, reference ID, bid start, bid close, forced close, and pickup date, plus the British Auction config: trigger window **X**, extension **Y**, and trigger type.
3. **Details** (`/rfq/:id`): the ranking table (L1, L2, …) with the full quote breakdown, the X/Y/trigger config, the activity log (bids and extensions, each with its reason), a live countdown, and a quote form. Use the **"Acting as carrier"** dropdown to switch between suppliers. There is no auth.

Updates are pushed over **Server-Sent Events** (`/api/events`). If SSE fails, the client falls back to polling every 5 s.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/suppliers` | List suppliers (demo identities) |
| GET | `/api/rfqs` | `{ serverTime, rfqs }`: auctions with status, lowest bid, bid count |
| POST | `/api/rfqs` | Create RFQ. Body: `referenceId, name, bidStartTime, bidCloseTime, forcedCloseTime, pickupDate, triggerWindowMinutes, extensionMinutes, triggerType` (`BID_RECEIVED`/`ANY_RANK_CHANGE`/`L1_CHANGE`) |
| GET | `/api/rfqs/:id` | Details: ranked bids, all bids, activity log, status, server time |
| POST | `/api/rfqs/:id/bids` | Place a bid. Body: `supplierId, freightCharges, originCharges, destinationCharges, transitTimeDays, quoteValidUntil`. Returns `{ bid, rank, extension }` |
| GET | `/api/events` | SSE stream; emits `{rfqId}` whenever an RFQ changes |

Errors come back as `{ error, details? }` with status 400 (validation, malformed JSON), 404, or 409 (bidding not open / duplicate ref ID). Numbers and dates are parsed strictly: empty strings and `null` are rejected, and numeric strings are accepted only if non-empty.

Countdowns use the `serverTime` returned by the list and details endpoints, so a wrong client clock doesn't affect them. The client also refetches whenever the SSE connection (re)opens.

Example:
```bash
curl -X POST localhost:4000/api/rfqs -H 'content-type: application/json' -d '{
 "referenceId":"RFQ-2001","name":"Demo","bidStartTime":"2026-10-22T10:00:00Z","bidCloseTime":"2026-10-22T18:00:00Z",
 "forcedCloseTime":"2026-10-22T18:30:00Z","pickupDate":"2026-10-30T00:00:00Z",
 "triggerWindowMinutes":10,"extensionMinutes":5,"triggerType":"L1_CHANGE"}'
```

## Auction rules as implemented
- **Total price** = freight + origin + destination, and must be > 0. Bids are ranked by this total. Money is stored as integer minor units (paise/cents); the API takes and returns decimal amounts with at most 2 decimal places.
- **Quote validity** must be in the future.
- **Ranking**: only each supplier's **latest** bid counts. Lower total ranks higher. On a tie, the earlier bid ranks higher.
- **Re-bids** are allowed, but each one must be **strictly lower** than the supplier's own previous bid. That matches the "continuously lower prices" idea of a British auction and stops a supplier from gaming ranks by raising a bid. A supplier does *not* have to beat L1.
- **Bids are accepted only while the auction is Active**: `bidStartTime <= now < currentCloseTime`.
- **Trigger window** is `[currentCloseTime − X, currentCloseTime)`, measured against the *current* close time, which may already have been extended.
- **Triggers** (one per RFQ):
  - `BID_RECEIVED`: any accepted bid in the window extends the auction.
  - `ANY_RANK_CHANGE`: extends if the supplier order changes. A new supplier entering the ranking counts as a change.
  - `L1_CHANGE`: extends only if the L1 supplier changes. The first bid on an RFQ counts, because L1 goes from none to that supplier. L1 lowering its own price does **not** count.
- **Extension**: `newClose = min(currentClose + Y, forcedClose)`. Once `currentClose == forcedClose`, no more extensions happen.
- **Status**: Upcoming (before start), Active, Closed (ended at a close time earlier than forced close), Force Closed (bidding ran until the forced close time).
- **Concurrency**: bid processing is serialized per RFQ (in-process keyed mutex plus a DB transaction). See [HLD](docs/HLD.md#concurrency).

## Assumptions
- There is no authentication. The supplier dropdown simulates identity, and the buyer is implicit.
- Times are stored in UTC and shown in the browser's local timezone.
- Currency is a single unit, shown as USD.
- The API runs as a single instance. Scaling out needs the DB-level locking and Redis pub/sub described in the HLD.
- Transit time is in whole days. "Validity of quote" is a date.
