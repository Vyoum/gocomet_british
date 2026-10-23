# RFQ System with British Auction

> Carriers bid openly on freight RFQs; bids near the close auto-extend the auction, but never past a hard forced-close time.

[![CI](https://github.com/Vyoum/gocomet_british/actions/workflows/ci.yml/badge.svg)](https://github.com/Vyoum/gocomet_british/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-Vite%20%2B%20Tailwind-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)

**Live**
- Frontend: https://auctionhouseassignment.vercel.app
- Backend: https://gocomet-british-fastapi.onrender.com
- Health: https://gocomet-british-fastapi.onrender.com/api/health

> The backend runs on Render's free tier and sleeps when idle. The first request can take **about 1 minute** to wake it. Open the Health link first and wait for `{"ok":true,...}`.

## 60-second walkthrough for reviewers

The seed creates five carriers: **Maersk Line, BlueDart Logistics, DHL Global Forwarding, Gati Cargo, Safexpress**. It also creates five RFQs: **RFQ-1001 Mumbai → Rotterdam 2x40HC** (Bid received trigger, X=10, Y=5), RFQ-1002 Delhi → Chennai FTL 20T (L1 change), RFQ-1003 Chennai → Singapore LCL (Any rank change, X=5, Y=3), RFQ-1004 Kolkata → Dhaka Air (upcoming), and RFQ-0999 Pune → Bengaluru PTL (closed). RFQ-1001 already has bids from Maersk Line (L1, $2,200.00), BlueDart Logistics and DHL Global Forwarding.

> **Timing differs between environments.** The live deployment uses `python -m app.seed --demo`, which gives 1–2 week bid windows, so a bid there won't land in the trigger window. To watch extensions and the forced-close cap happen, run the app locally with `python -m app.seed`. That seed sets RFQ-1001 to close about 8 min after seeding, inside its 10-minute window, with forced close at about +30 min. RFQ-1003 closes at about +3 min with forced close at about +15 min. On the live site you can also create your own RFQ with a short window (see step 6).

1. **Listing (`/`).** Every RFQ appears with its lowest bid, the top three leaders (L1/L2/L3), current close (including the number of extensions), a live countdown, forced close and status.
2. **Switch role (header, marked "demo").** Choose **Buyer**. *+ New RFQ* is visible. On a details page you see every bid and rank, and the quote form is replaced by a note saying buyers can't bid.
3. **Switch to `Supplier: DHL Global Forwarding`.** *+ New RFQ* disappears and the listing shows a **"You are L3"** chip on RFQ-1001. Open RFQ-1001: a banner reads *You are L3*, your row is highlighted, and the carrier field is fixed to *DHL Global Forwarding*.
4. **Place a bid** below the current L1, for example Freight 1900, Origin 100, Destination 100 (total $2,100.00, which beats $2,200.00). You'll see *Bid accepted — you are L1* plus the extension reason. The banner changes to *You are L1*, and every open tab updates over SSE.
5. **Activity log.** A `BID_PLACED` entry appears, then an `EXTENDED` entry giving the reason (bid inside the last 10 min) and the new close time, 5 min later. *Current close* now shows `(+1 ext)`.
6. **Forced-close cap.** Keep bidding lower on RFQ-1003 inside its window, or create an RFQ as Buyer with close = now+3 min, forced close = now+6 min and X=5, Y=5. Once an extension would pass the forced close, the close time is clamped to it and an **`EXTENSION CAPPED`** entry records the requested and granted minutes. When time runs out the status becomes **Force Closed**.
7. **Type a new carrier.** Pick *+ New carrier…* in the switcher and enter a name. The carrier is created (get-or-create) and you're now acting as it.

The *Open demo (no role)* option, which is the default, sends no role headers. It keeps the original behaviour: anyone can create RFQs and bid as any carrier from a dropdown.

## Requirement coverage

| Requirement (assignment spec) | Where it's implemented |
|---|---|
| §5 RFQ creation: name / reference ID, bid start, bid close, forced close, pickup date | `frontend/src/pages/CreatePage.tsx`, `POST /api/rfqs` → `service.create_rfq`, `schemas.RfqIn` |
| §5/§7 Forced close must be later than bid close | `schemas.RfqIn` validator (400), DB `CHECK rfq_forced_after_close`, client-side disabled submit |
| §5 Quote form: carrier, freight / origin / destination, transit time, validity | `DetailsPage.tsx` `BidForm`, `POST /api/rfqs/:id/bids`, `schemas.BidIn` |
| §5/§7 Never extend beyond forced close | `auction.evaluate_extension`: `min(currentClose + Y, forcedClose)`; `CHECK rfq_current_le_forced`; `EXTENSION_CAPPED` log |
| §6.1 Trigger window X | `Rfq.triggerWindowMinutes`; window `[currentClose − X, currentClose)` in `auction.py` |
| §6.2 Extension duration Y | `Rfq.extensionMinutes`; applied in `auction.evaluate_extension` |
| §6.3 Triggers (bid received / any rank change / L1 change) | `triggerType` enum + `auction.py`; unit tests in `tests/test_auction.py` |
| §8 Listing: name/ID, lowest bid, current close, forced close, status | `ListPage.tsx`, `GET /api/rfqs` → `service.list_rfqs` |
| §8 Details: bids sorted by price, L1/L2/L3, quote details, X/Y/trigger config | `DetailsPage.tsx`, `GET /api/rfqs/:id` → `service.get_rfq_details`, `auction.rank_bids` |
| §8 Activity log: bids, extensions, reason for each extension | `ActivityLog` table, `service.place_bid`, details page activity panel |
| §2 Clear visibility of progress | live countdowns using server clock offset, SSE `/api/events`, extension counts |
| Buyer vs supplier participants (§1) | Demo role switch: `frontend/src/role.ts`, `components/RoleSwitcher.tsx`, `get_viewer` in `backend/app/main.py` |
| §9 HLD with architecture diagram | [docs/HLD.md](docs/HLD.md) |
| §9 DB schema design | [docs/SCHEMA.md](docs/SCHEMA.md), `backend/alembic/versions/` |
| §9 Backend / frontend code | `backend/`, `frontend/` |

## Architecture

Full design: [docs/HLD.md](docs/HLD.md). Schema: [docs/SCHEMA.md](docs/SCHEMA.md).

```mermaid
flowchart LR
  subgraph Browser
    UI[React SPA<br/>List / Create / Details<br/>demo role switch]
  end
  subgraph API[FastAPI - Python 3.12, uvicorn]
    R[Routes + Pydantic v2 validation<br/>X-Role / X-Supplier demo rules]
    S[Auction service<br/>place_bid / create_rfq]
    E[Pure auction engine<br/>rank_bids · evaluate_extension · get_status]
    B[Event bus<br/>asyncio queues]
    RL[Redis relay<br/>only if REDIS_URL set]
  end
  DB[(PostgreSQL<br/>SQLAlchemy 2.0 async + psycopg 3<br/>Alembic migrations)]
  subgraph Optional[Optional - only when REDIS_URL / CELERY_BROKER_URL is set]
    RD[(Redis<br/>broker + pub/sub)]
    BT[Celery beat<br/>every CLOSE_SWEEP_SECONDS]
    W[Celery worker<br/>close_due_auctions]
  end
  UI -- "REST JSON (+ Idempotency-Key, X-Role)" --> R --> S
  S --> E
  S -- "transaction + SELECT ... FOR UPDATE" --> DB
  S -- rfq changed --> B -- SSE /api/events --> UI
  BT -- schedule --> RD -- task --> W
  W -- "FOR UPDATE SKIP LOCKED; closedStatus + AUCTION_* log" --> DB
  W -- "PUBLISH rfq:events" --> RD -- subscribe --> RL --> B
```

### Key engineering decisions
- **Row lock per RFQ.** Each bid runs in a single transaction that starts with `SELECT … FOR UPDATE` on the RFQ row. Concurrent bids queue on that lock, and each one sees the previous bid and any extension it caused. This also works across several API instances ([HLD › Concurrency](docs/HLD.md#concurrency)).
- **Integer money.** Charges are stored as integer minor units (cents/paise). The API accepts and returns decimals with at most 2 places, so no float rounding goes into ranking.
- **CHECK constraints as a backstop.** Postgres enforces `forced > close > start`, `bidClose ≤ currentClose ≤ forcedClose`, non-negative charges, total > 0, transit > 0 and the valid trigger types, even if application validation is bypassed.
- **Idempotency key.** A bid `POST` may include `Idempotency-Key`. A retry with the same key and payload replays the original 201 response (`Idempotent-Replayed: true`) without writing anything; the same key with a different payload returns 422. The UI reuses one key per submission when retrying network or 5xx failures.
- **Status derived from timestamps.** Upcoming, Active, Closed and Force Closed are computed from the times on every read, so no cron job is needed to get correct status.
- **SSE for live updates.** `/api/events` pushes `{rfqId}` and clients refetch. If SSE fails, the client polls every 5 s. Countdowns use `serverTime` from the API, so a wrong client clock doesn't matter.
- **Optional Celery + Redis closer.** If `REDIS_URL` is set, a beat/worker pair records `AUCTION_CLOSED` / `AUCTION_FORCE_CLOSED` exactly once and relays SSE events across instances. Without Redis the app runs unchanged.
- **Demo roles, not auth.** See below.

### Demo buyer / supplier roles (NOT authentication)
The role switcher in the header exists only for the demo. It is **not authentication**, and the server trusts whatever headers the client sends.

- The chosen role is saved in `localStorage` (`rfq.demoRole`). Every API request then carries `X-Role: buyer` or `X-Role: supplier` plus `X-Supplier: <carrier name>`.
- Rules enforced by the backend (`get_viewer`, `forbid_supplier` and `forbid_buyer` in `backend/app/main.py`):
  - `X-Role: supplier` → `POST /api/rfqs` returns **403**. A bid whose `supplierId` doesn't belong to the `X-Supplier` carrier (case-insensitive name match) returns **403**. `GET /api/rfqs` adds `myRank`, the supplier's own rank or `null`.
  - `X-Role: buyer` → `POST /api/rfqs/:id/bids` returns **403**.
  - An unknown `X-Role`, or `supplier` sent without `X-Supplier`, returns **400**.
  - **No `X-Role` header gives the legacy behaviour**, byte-for-byte the same as before, so existing clients and tests are unaffected.
- **How real auth would slot in.** Replace `get_viewer` with a dependency that checks `Authorization: Bearer <JWT>` (signature, expiry, issuer) and reads `role` and `supplier_id` from the claims. The rules above stay as they are. The supplier check should then compare `supplierId` with the token's `supplier_id` instead of a name. `POST /api/suppliers` would become an admin or onboarding action, and the frontend switcher would be replaced by login. The legacy no-header path would be removed.

## API reference

Base URL: `http://localhost:4000` locally, or `https://gocomet-british-fastapi.onrender.com` live. Errors are returned as `{ "error": string, "details"?: [...] }`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | `{ ok, time }` |
| GET | `/api/suppliers` | List carriers `[{ id, name }]` |
| POST | `/api/suppliers` | Demo helper: get-or-create a carrier by name. Body `{ "name": "..." }`, returns `{ id, name }` |
| GET | `/api/rfqs` | `{ serverTime, rfqs }`: status, lowest bid, bid/supplier counts, `topRanks` (top 3); `myRank` only when `X-Role: supplier` |
| POST | `/api/rfqs` | Create an RFQ (201). Supplier role gets 403 |
| GET | `/api/rfqs/{id}` | Details: `rankedBids` (L1…), `allBids`, `activity`, config, `serverTime` |
| POST | `/api/rfqs/{id}/bids` | Place a bid (201): `{ bid, rank, extension }`. Optional `Idempotency-Key` (≤255 chars). Buyer role gets 403; a supplier bidding as another carrier gets 403 |
| GET | `/api/events` | SSE stream: `data: {"rfqId": "..."}` on every change, plus `: ping` every 20 s |

Status codes: 400 (validation, malformed JSON or bad role headers), 403 (demo role rule), 404, 409 (bidding not open, duplicate reference ID), 422 (`Idempotency-Key` reused with a different payload).

```bash
API=http://localhost:4000

curl -s $API/api/health
curl -s $API/api/suppliers
curl -s $API/api/rfqs

# Create an RFQ (as buyer; no X-Role behaves the same)
curl -s -X POST $API/api/rfqs -H 'content-type: application/json' -H 'X-Role: buyer' -d '{
  "referenceId":"RFQ-2001","name":"Demo lane","bidStartTime":"2026-10-23T10:00:00Z","bidCloseTime":"2026-10-30T18:00:00Z",
  "forcedCloseTime":"2026-10-30T18:30:00Z","pickupDate":"2026-11-05T00:00:00Z",
  "triggerWindowMinutes":10,"extensionMinutes":5,"triggerType":"L1_CHANGE"}'

# Place a bid as a supplier (supplierId must belong to X-Supplier, otherwise 403)
SID=$(curl -s $API/api/suppliers | python3 -c 'import sys,json;print([s["id"] for s in json.load(sys.stdin) if s["name"]=="Maersk Line"][0])')
curl -s -X POST $API/api/rfqs/<rfqId>/bids -H 'content-type: application/json' \
  -H 'X-Role: supplier' -H 'X-Supplier: Maersk Line' -H "Idempotency-Key: $(uuidgen)" -d "{
  \"supplierId\":\"$SID\",\"freightCharges\":1800,\"originCharges\":100,\"destinationCharges\":100,
  \"transitTimeDays\":12,\"quoteValidUntil\":\"2026-12-31\"}"

# Get-or-create a carrier (used by the "+ New carrier…" option)
curl -s -X POST $API/api/suppliers -H 'content-type: application/json' -d '{"name":"Acme Cargo"}'

# Live updates
curl -N $API/api/events
```

## Auction rules as implemented
- **Total price** = freight + origin + destination, and must be > 0. Bids are ranked by this total.
- **Ranking** uses each supplier's **latest** bid. A lower total ranks higher; on a tie, the earlier bid wins.
- **Re-bids** must be **strictly lower** than the supplier's own previous bid. They don't have to beat L1.
- **Bids are accepted only while Active**: `bidStartTime ≤ now < currentCloseTime`. Quote validity must be in the future.
- **Trigger window** = `[currentClose − X, currentClose)`, measured against the *current* (possibly already extended) close.
- **Triggers:** `BID_RECEIVED` fires on any accepted bid in the window. `ANY_RANK_CHANGE` fires when the supplier order changes (a new entrant counts). `L1_CHANGE` fires only when the L1 *supplier* changes (the first bid counts; L1 lowering its own price doesn't).
- **Extension:** `newClose = min(currentClose + Y, forcedClose)`. A clamped extension logs `EXTENSION_CAPPED`.
- **Status:** Upcoming, Active, Closed (ended before forced close) or Force Closed (ran until forced close).

## Testing

All counts below were measured on this branch.

| Suite | What it covers | Result |
|---|---|---|
| `cd backend && pytest` | Pure engine, validation, HTTP API (concurrency, idempotency, SSE, closer) and demo role rules (`tests/test_roles.py`, 8 tests) | **61 passed** |
| HTTP end-to-end script against a running API on :4200 | Full API contract, without role headers | **87/87** |
| Playwright UI flow (create → bid → rank → extension → errors) | Open-demo (no role) UI | **13/13** |
| Playwright screenshots at mobile/tablet/desktop widths | No horizontal overflow | **12/12** |
| Playwright role-switch flow | Buyer/supplier switching, header propagation, hidden controls, own-rank highlight, typed new carrier, 390 px layout | **20/20** |

CI (`.github/workflows/ci.yml`) runs pytest against a Postgres service and builds the frontend. The API tests create and migrate a throwaway `rfq_test` database (`TEST_DATABASE_URL`, default `postgresql://postgres:postgres@localhost:5432/rfq_test`). The e2e and Playwright scripts are local reviewer tooling and aren't part of CI.

## Local setup

### Docker Compose (everything)
```bash
docker compose up --build
# Postgres :5432, Redis :6379, API :4000 (demo data seeded into an empty DB), Celery worker + beat
cd frontend && npm install && npm run dev   # http://localhost:5173, proxies /api -> :4000
```

### Manual
Requires Python 3.12, Node 18+ and PostgreSQL (`docker compose up -d postgres` provides one).
```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env && set -a && source .env && set +a
alembic upgrade head
python -m app.seed          # WIPES data; short windows relative to now (good for seeing extensions)
uvicorn app.main:app --reload --port 4000

cd ../frontend && npm install && npm run dev   # http://localhost:5173
```
`python -m app.seed --demo` seeds 1–2 week windows, and only into an empty DB.

Optional auto-close job: set `REDIS_URL`, then from `backend/` run `celery -A app.worker worker --loglevel=info` and `celery -A app.worker beat --loglevel=info`.

## Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | backend | `postgresql://postgres:postgres@localhost:5432/rfq` | Postgres URL; `postgres://` and `postgresql://` are converted to psycopg 3 |
| `PORT` | backend (`start.sh`) | `4000` | uvicorn port |
| `CORS_ORIGIN` | backend | empty (allow all) | Comma-separated allowed origins. All request headers are allowed, including `X-Role`, `X-Supplier` and `Idempotency-Key` |
| `SEED_DEMO` | backend (`start.sh`) | `false` | `true` = run `app.seed --demo` on start (empty DB only) |
| `REDIS_URL` / `CELERY_BROKER_URL` | backend | unset | Enables the Celery closer and the Redis SSE relay |
| `CLOSE_SWEEP_SECONDS` | backend | `15` | Celery beat interval |
| `TEST_DATABASE_URL` | tests | `…/rfq_test` | Throwaway DB for pytest |
| `VITE_API_URL` | frontend (build time) | empty (same origin / Vite proxy) | Backend origin, e.g. the Render URL, with no `/api` |

## Deployment (Render + Vercel)
- **Backend:** Render Blueprint (`render.yaml`) provisions a free Postgres plus a Python web service (`rootDir: backend`, start `bash start.sh`: migrate → optional demo seed → uvicorn, health check `/api/health`). Set `CORS_ORIGIN` to the Vercel origin(s).
- **Frontend:** Vercel project with root `frontend` and env `VITE_API_URL=<Render URL>`. `vercel.json` rewrites every route to `index.html`.
- Redis and Celery are intentionally **not** in `render.yaml` (they're paid services). Without them the app is fully functional.

## Project structure
```
backend/
  app/
    main.py        FastAPI app, routes, CORS, error handlers, demo role dependencies
    service.py     Transactions: create_rfq, place_bid (row lock, idempotency), list/details, ensure_supplier
    auction.py     Pure engine: ranking, trigger window, extension, status
    schemas.py     Pydantic v2 request models (strict decimals/dates -> minor units)
    models.py      SQLAlchemy models   money.py / serialize.py / errors.py helpers
    events.py      In-process SSE bus + optional Redis relay
    closer.py, worker.py   Optional Celery auto-close job
    seed.py        Dev (short windows) and --demo (long windows) seed data
  alembic/         Migrations (tables, CHECK constraints, indexes)
  tests/           pytest: engine, validation, API, improvements, roles
frontend/src/
  api.ts           Fetch wrapper (role headers, idempotent bid retry), SSE subscribe
  role.ts          Demo role state (localStorage) + header builder
  components/      RoleSwitcher.tsx, ui.tsx (badges, countdown, formatting)
  pages/           ListPage, CreatePage, DetailsPage
docs/              HLD.md (architecture, sequence, concurrency), SCHEMA.md
docker-compose.yml, render.yaml, .github/workflows/ci.yml
```

## Assumptions
- Roles are a demo switch, not authentication (see above).
- Times are stored in UTC and displayed in the browser's timezone. There is a single currency, shown as USD.
- Transit time is in whole days. Quote validity is a date.
- Bid locking works across instances because it is a Postgres row lock. The SSE bus is in-process, and across instances it uses the optional Redis relay.
