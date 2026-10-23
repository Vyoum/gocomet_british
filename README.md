# RFQ System with British Auction

A simplified RFQ (Request for Quotation) platform where carriers bid openly on freight RFQs using **British Auction** rules: automatic time extensions near the close, configurable triggers, and a hard **forced close**.

- `backend/`: Python 3.12, FastAPI, SQLAlchemy 2.0 (async) + Alembic, Pydantic v2, psycopg 3, PostgreSQL, SSE for live updates, pytest
- `frontend/`: React, Vite, TypeScript, Tailwind
- `docs/`: [HLD](docs/HLD.md) and [DB schema](docs/SCHEMA.md)

## Local setup

Requires Python 3.12, Node 18+ (frontend only) and PostgreSQL. The easiest way to get Postgres is Docker.

```bash
# 0. Postgres (from repo root): postgres:postgres@localhost:5432/rfq
docker compose up -d postgres

# 1. Backend
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env && set -a && source .env && set +a   # DATABASE_URL etc.
alembic upgrade head
python -m app.seed               # wipes data and loads short-window demo data
uvicorn app.main:app --reload --port 4000   # http://localhost:4000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev            # http://localhost:5173  (proxies /api -> :4000)
```

Alternatively, `docker compose up --build` runs Postgres and the API container together (API on :4000, with demo data seeded into an empty DB).

**Tests**: `cd backend && pytest`. They cover the pure engine, validation and the HTTP API, including a concurrent-bid test. The API tests need Postgres: they create and migrate a throwaway `rfq_test` database, set by `TEST_DATABASE_URL`, which defaults to `postgresql://postgres:postgres@localhost:5432/rfq_test`. CI (`.github/workflows/ci.yml`) runs them against a Postgres service and also builds the frontend.

You can re-seed at any time with `python -m app.seed`. **This wipes all data** and creates RFQs relative to *now*, so there are always auctions that are active, already in their trigger window, upcoming, and closed. `python -m app.seed --demo` uses 1–2 week windows instead and only seeds an empty DB.

## Deployment (Render + Vercel)

**1. Backend + database on Render**
1. Push this repo to GitHub.
2. In Render, go to **New → Blueprint**, select the repo, and apply. `render.yaml` creates:
   - `gocomet-british-db`: a free Postgres database.
   - `gocomet-british-api`: a Python web service with `rootDir: backend`.
     - Build: `pip install -r requirements.txt`.
     - Start: `bash start.sh`. This runs `alembic upgrade head`, then `python -m app.seed --demo` if `SEED_DEMO=true` (empty DB only), then `uvicorn` on `$PORT`.
     - Health check: `/api/health`. `DATABASE_URL` is wired to the database automatically, and the `postgresql://` URL Render gives is converted to `postgresql+psycopg://` in code.
3. Leave `CORS_ORIGIN` empty for now. Once deployed, note the URL, e.g. `https://gocomet-british-api.onrender.com`, and check that `/api/health` returns `{"ok":true}`.
4. Demo data: `SEED_DEMO=true` (set in `render.yaml`) seeds only when the DB is empty. To force a fresh short-window dataset, run `python -m app.seed` from the service **Shell**. This wipes existing data.

**Switching an existing Render deployment from the old Node backend**
- **Runtime**: change `runtime: node` → `python`. Render's docs say you can do this with a Blueprint sync, or in the Dashboard under **Settings → Build → Source → Edit**. If the sync rejects it, change it in the Dashboard with the build/start commands above, or create a new Python service.
- **Database**: the first Alembic migration **drops the old Prisma tables** (`Supplier`, `Rfq`, `Bid`, `ActivityLog`, `_prisma_migrations`) and recreates them. Existing data is discarded, and the demo seed then repopulates the empty DB. See [SCHEMA](docs/SCHEMA.md#migrating-from-the-prisma-schema).

**2. Frontend on Vercel**
1. In Vercel, go to **Add New → Project** and import the repo.
2. Set **Root Directory** to `frontend`. Vercel auto-detects the Vite preset: build `npm run build`, output `dist`.
3. Add the environment variable `VITE_API_URL` = your Render URL, e.g. `https://gocomet-british-api.onrender.com`, with no trailing slash and no `/api`.
4. Deploy. `frontend/vercel.json` rewrites every path to `index.html`, so client-side routes like `/rfq/:id` work when the page is reloaded.

**3. Lock down CORS**
- On Render, set `CORS_ORIGIN` on `gocomet-british-api` to the Vercel URL, e.g. `https://gocomet-british.vercel.app`. Comma-separate multiple origins. Saving triggers a redeploy.

Note: free Render services sleep when idle, so the first request after a while can take about 30–60 s.

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
- **Concurrency**: each bid runs in one DB transaction that first takes `SELECT ... FOR UPDATE` on the RFQ row, so bids on the same RFQ are serialized even across multiple API instances. See [HLD](docs/HLD.md#concurrency).

## Assumptions
- There is no authentication. The supplier dropdown simulates identity, and the buyer is implicit.
- Times are stored in UTC and shown in the browser's local timezone.
- Currency is a single unit, shown as USD.
- Bid locking already works across instances, because it uses a Postgres row lock. The SSE event bus is in-process, so running more than one instance needs Redis pub/sub (see HLD). Close notifications via Celery + Redis are described in the HLD but not implemented.
- Transit time is in whole days. "Validity of quote" is a date.
