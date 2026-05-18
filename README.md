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
- Profiles are stored locally in SQLite at `data/dashboard.sqlite`.
- Bus setup starts from route number, then loads directions and stop-name choices. The app hides official stop IDs in the UI but stores them internally because the ETA APIs require them.
- Co-operated routes can merge operators such as KMB + Citybus and keep each operator's own direction/stop IDs behind one visible route direction.
- MTR setup uses start and destination stations; the app resolves the first train line/direction and indicative route automatically.
- Car setup uses a map pin picker; the app stores coordinates behind the scenes for TomTom routing.
- TomTom car routing is cached server-side per route: 10 minutes on local/dev, 2 minutes on Render/production. It stops refreshing after the profile's latest-arrival target has passed.
- The traffic-flow pane matches TomTom route guidance road names to HK Gov live speed segments. It is route context, not exact geometry matching.
- Traffic-flow matching ignores generic numeric route tokens and de-duplicates cards by matched HK road name. For the Eastern Harbour to Aberdeen/Stubbs corridor, it expands sparse TomTom guidance with the expected road sequence before matching.
- Traffic-flow matching is indexed and route-candidate capped so debug matching cannot monopolize the API server.
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

Set `NODE_VERSION=18.20.4` if Render does not pick up `.node-version`.
