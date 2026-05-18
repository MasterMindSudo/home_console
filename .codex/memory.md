# Workspace Memory

Read this file at the start of future Codex sessions when the chat context is missing, compacted, or confusing. It is intentionally a concise project memory, not a full spec.

## Project

- Repo/workspace: `c:\Users\Kevin\Documents\Project\bus_eta`
- GitHub remote: `https://github.com/MasterMindSudo/home_console.git`
- Production branch: `main`
- Development branch: `dev`
- App name: Household Transit Dashboard / home console
- Primary user: Kevin
- Purpose: iPad/static-display web dashboard for household commute decisions in Hong Kong.
- Production site: `https://home-console.onrender.com/`
- Render deploy hook exists, but it is private. Do not print or commit the hook URL/key.

## Current Stack

- Frontend: React + Vite + TypeScript.
- Backend: Node/Fastify + TypeScript.
- Storage: Postgres via `DATABASE_URL` when configured, otherwise SQLite via `better-sqlite3`.
- Local SQLite fallback path: `data/dashboard.sqlite`.
- Shared types live in `shared/types.ts`.
- Main dashboard assembly: `server/src/services/dashboard.ts`.
- Backend entrypoint: `server/src/index.ts`.
- Dashboard UI: `client/src/components/Dashboard.tsx`.
- Profile setup UI: `client/src/components/ProfileForm.tsx`.

## Commands

- Install on old local Node if needed: `npx npm@8 install`
- Dev server: `npm run dev`
- Client URL: `http://localhost:5173`
- API URL: `http://localhost:5174`
- Typecheck: `npm run typecheck`
- Tests: `npm test`
- Production build: `npm run build`
- Start built server: `npm run start`

## Deployment Notes

- Normal development should happen on `dev`.
- Do not push every small change to `main`.
- Only merge `dev` to `main` for deliberate major/stable releases.
- Trigger Render redeployment only after merging a release to `main`, unless Kevin explicitly asks for an emergency prod deploy.
- Render service should be a Node Web Service, not a Static Site.
- Build command: `npm ci && npm run build`
- Start command: `npm run start`
- Health path: `/api/health`
- Node should be 18.x. `.node-version` and `package.json` engines pin this because Node 26 broke `better-sqlite3`.
- Required env vars include `TOMTOM_API_KEY`.
- Optional TomTom backup key env aliases: `TOMTOM_BACKUP_API_KEY`, `TOMTOM_API_KEY_BACKUP`, `TOMTOM_BACKUP_KEY`, `TOMTOM_FALLBACK_API_KEY`, `TOMTOM_API_KEY_2`, `TOMTOM_SECONDARY_API_KEY`, `TOMTOM_SECONDARY_KEY`, or `TOMTOM_BACKUP`.
- Restart the dev server after `.env` changes because keys are read on backend startup.
- `.env` is local and gitignored. Never reveal or commit secrets from it.
- On Render, set `DATABASE_URL` to Postgres so profiles persist across inactivity restarts. SQLite is now local fallback only.

## Important Product Decisions

- V1 is transit-first; household todo/voice is future work.
- No login in v1.
- Saved commute profiles are server-side, not browser localStorage.
- UI should be glanceable for iPad/static display.
- Primary static-display target is now `1920x1080`; keep the dashboard fitting a 16:9 screen without requiring touch/scroll interaction where possible.
- English-first UI.
- Bus route setup is route-first: select route, then direction, then stop names.
- Co-operated routes such as KMB + Citybus should be unified in the UI as one route/direction where possible.
- Co-operated route direction merging must be generic. Do not hardcode route numbers; use terminal-name compatibility so operator naming variants like `KAI TAK (KAI CHING ESTATE)` and `Kai Ching Estate` merge.
- Shared-code bus route sampling has covered common KMB+CTB routes including `641`, `671`, `170`, `601`, `680`, `914`, `948`, and `980X`; remaining split cases are usually real short-workings/one-way branches or genuinely different street terminals.
- The UI should show stop names, not stop IDs; stop IDs remain internal because APIs need them.
- MTR setup should use only start station and destination station; route/line/interchange is resolved automatically.
- MTR estimate excludes walking time.
- Car setup uses map pins/coordinates, not manual address entry.
- Car ETA shows fastest and less-toll/toll-free style options.
- Traffic pane uses TomTom route guidance road names matched to HK Gov speed segment data; this is approximate context, not geometry matching.
- HK live speed XML is cached server-side for 2 minutes; dashboard polling can be faster but should reuse cached speed data within that window.
- Sidebar includes a Traffic debug page for TomTom/traffic-flow integration testing. It has no auto refresh; manual Update calls `/api/debug/traffic-flow/:profileId`, force-refreshes TomTom by default, bypasses latest-arrival cutoff, skips toll-free by default for speed, and shows key-presence booleans plus TomTom/HK-flow timings.
- Weather uses hourly cards, not a line chart, because temp/humidity/rain have incompatible scales.

## Data Sources And Adapters

- Bus:
  - Adapter: `server/src/adapters/bus.ts`
  - KMB ETA/open route data and Citybus ETA/open route data.
  - Co-operated stop IDs are stored per operator.
  - Previous origin stop ETA is fetched and shown before the origin stop card/node.
- MTR:
  - Adapter: `server/src/adapters/mtr.ts`
  - Uses station graph resolution from start to destination.
- Car:
  - Adapter: `server/src/adapters/tomtom.ts`
  - Uses TomTom Routing API server-side only.
  - TomTom calls are cached server-side per car route: 10 minutes on local/dev, 2 minutes on Render/production.
  - If the primary TomTom key returns quota/limit-style 403/429 errors, the adapter retries with the backup key when configured.
  - TomTom refresh stops after the profile latest-arrival target has passed for the Hong Kong day.
- Tunnel:
  - Adapter: `server/src/adapters/tunnel.ts`
  - Legacy HK journey-time indicator support exists, but it is no longer rendered in the dashboard.
- Traffic flow:
  - Adapter: `server/src/adapters/trafficFlow.ts`
  - Uses `irnAvgSpeed-all.xml` live speeds and `speed_segments_info.csv` segment road names.
  - TomTom fastest-route guidance road names are normalized and matched to HK segment `route` names.
  - Generic numeric route tokens are ignored for cards because they create broad false matches such as route `7`.
  - Matched cards are de-duplicated by HK road name.
  - Eastern Harbour to Aberdeen/Stubbs trips expand sparse TomTom guidance with the expected road order before HK speed matching.
  - Matching uses indexed road lookups and caps route candidates so a debug request cannot wedge the Fastify event loop.
  - Traffic camera snapshots use `Traffic_Camera_Locations_En.csv` metadata and `tdcctv.data.one.gov.hk/{key}.JPG`; matched cameras attach to speed-flow roads, and camera-only cards are inserted in route order when no speed segment card exists.
  - Frontend appends a 2-minute cache-buster to traffic camera image URLs so snapshots refresh without extra backend calls.
- Weather:
  - Adapter: `server/src/adapters/weather.ts`
  - Uses Open-Meteo for Hong Kong hourly temp, relative humidity, precipitation.
  - Frontend renders 24-hour horizontally scrollable cards anchored so current hour is first visible.

## Bus ETA Pairing Rules

- Exact run/vehicle matching is preferred if a future API exposes usable `runId`.
- Current practical fallback is same operator/order estimate.
- Never pair a destination ETA that is too close to the origin ETA.
- Current minimum order-based downstream travel gap is 30 minutes in `server/src/services/time.ts`.
- If no plausible destination ETA exists, pairing should be unavailable/unknown rather than giving a false late/on-time decision.
- The previous-stop ETA is a signal for whether the bus has likely departed the previous stop.

## Time Handling

- Hong Kong time matters even when Render runs in UTC.
- `server/src/services/time.ts` parses timezone-less API timestamps as `+08:00`.
- Latest-arrival target must be calculated in Hong Kong calendar time, not server local/UTC date.
- There are regression tests in `server/test/time.test.js` for timezone and ETA pairing.

## Current UI Layout Ideas

- Top hero: recommendation/status and current time.
- Only the dashboard is locked to the 1920x1080 wall-display layout; setup/edit/debug pages should scroll normally.
- Weather pane near the top: horizontally scrollable 24-hour cards, current hour leftmost/highlighted.
- Main board:
  - Bus lane with previous stop, origin ETA, route track, destination/ride estimate.
  - MTR lane.
  - Car comparison rows.
  - Blue road-sign inspired traffic-flow side panel with compact two-column speed cards and one enlarged camera feed rotating every 5 seconds in card/route order.
- Upcoming bus pairings table below.
- Large display CSS breakpoint starts at `1600px x 900px` and is tuned for `1920x1080`.

## Coding Habits For This Repo

- Use `rg` first for search.
- Use `apply_patch` for file edits.
- Avoid leaking `.env` or deploy hook values.
- Before pushing, run at least `npm run typecheck`; for dashboard/backend changes also run `npm test` and `npm run build`.
- Commit normal work to `dev` and push `dev`.
- Keep `main` for release merges only. After a release merge to `main`, trigger Render redeployment if Kevin wants prod updated.
