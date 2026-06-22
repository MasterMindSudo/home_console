# Household Transit Dashboard

Local web dashboard for household commute decisions in Hong Kong. V1 focuses on a glanceable iPad/static-display transit screen with saved commute profiles, bus ETAs, MTR next-train based estimates, TomTom driving ETA, and cross-harbour journey-time context.

## Workspace Memory

Long-term project notes for future Codex sessions live in `.codex/memory.md`. Read it first when chat history is missing or compacted.

## Branch Workflow

- Use `dev` for ongoing development.
- Keep `main` as the production/release branch.
- Merge to `main` only for major or stable updates.
- Trigger Render redeployment only after a deliberate `main` release merge, unless an emergency production fix is requested.

## Setup

```bash
npx npm@8 install
copy .env.example .env
npm run dev
```

Open the client at `http://localhost:5173`.

## Configuration

- Put your main TomTom key in `.env` as `TOMTOM_API_KEY`. Optional backup aliases are `TOMTOM_BACKUP_API_KEY`, `TOMTOM_API_KEY_BACKUP`, or `TOMTOM_BACKUP_KEY`.
- Restart the dev server after changing `.env`; the backend only reads TomTom keys at startup.
- Profile storage auto-selects by env:
  - `DATABASE_URL` set: use Postgres (recommended on Render).
  - `DATABASE_URL` empty: use local SQLite at `data/dashboard.sqlite`.
- Optional `DATABASE_SSL`:
  - `require` / `true` enables SSL with `rejectUnauthorized: false` (typical for Render external hostnames).
  - `disable` / `false` turns SSL off (typical for trusted internal/private networks).
- Supabase server integration reads `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `SUPABASE_JWKS_URL`.
- `GET /api/supabase/status` checks Supabase server config wiring.
- `GET /api/supabase/me` uses Supabase `auth: "user"` and returns verified JWT claims.
- When `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set, `/api/profiles` reads and writes the `profiles` table through Supabase/PostgREST instead of the legacy SQLite/Postgres profile store.
- The matching table definition is in `supabase/profiles.sql`.
- Local SQLite remains in use for non-profile caches such as GTFS unless you explicitly migrate those too.
- Create the table once in the Supabase SQL Editor using `supabase/profiles.sql`, then run `npm run migrate:profiles:supabase` to upsert existing SQLite profiles by ID.
- When Supabase is configured, a legacy `DATABASE_URL` is ignored so a retired Postgres host cannot prevent the app from starting.
- Bus setup starts from route number, then loads directions and stop-name choices. The app hides official stop IDs in the UI but stores them internally because the ETA APIs require them.
- Co-operated routes can merge operators such as KMB + Citybus and keep each operator's own direction/stop IDs behind one visible route direction.
- MTR setup uses start and destination stations; the app resolves the first train line/direction and indicative route automatically.
- Car setup uses a map pin picker; the app stores coordinates behind the scenes for TomTom routing.
- TomTom car routing is cached server-side per route: 10 minutes on local/dev, 2 minutes on Render/production. It stops refreshing after the profile's latest-arrival target has passed.
- The traffic-flow pane matches TomTom route guidance road names to HK Gov live speed segments. It is route context, not exact geometry matching.
- Traffic-flow matching ignores generic numeric route tokens and de-duplicates cards by matched HK road name. For the Eastern Harbour to Aberdeen/Stubbs corridor, it expands sparse TomTom guidance with the expected road sequence before matching.
- Traffic-flow matching is indexed and route-candidate capped so debug matching cannot monopolize the API server.
- The dashboard keeps traffic-flow cards speed-first in a compact two-column wall-display layout and shows one enlarged matched traffic camera feed rotating every 5 seconds in route/card order.
- Traffic camera image URLs get a 2-minute frontend cache-buster so snapshots refresh on the public camera cadence without extra backend calls.
- HK speed XML is cached server-side for 2 minutes, so frequent dashboard refreshes reuse speed data inside that window.
- The sidebar Traffic debug page has no auto refresh; use its Update button to manually test TomTom road-name extraction and HK speed-flow matching.
- Traffic debug force-refreshes TomTom by default, skips toll-free by default for faster route-flow testing, shows backend key visibility, and reports TomTom/HK-flow timings.

## Scripts

```bash
npm run dev        # Fastify API + Vite client
npm run build      # TypeScript server + production client bundle
npm test           # Build server and run core time/ETA pairing tests
npm run start      # Start built API server
```

## Render

Use a Node Web Service with:

```bash
npm ci && npm run build
npm run start
```

Set `NODE_VERSION=20.19.0` if Render does not pick up `.node-version`.
