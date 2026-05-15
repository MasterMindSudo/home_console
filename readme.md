# Household Transit Dashboard

Local web dashboard for household commute decisions in Hong Kong. V1 focuses on a glanceable iPad/static-display transit screen with saved commute profiles, bus ETAs, MTR next-train based estimates, TomTom driving ETA, and cross-harbour journey-time context.

## Setup

```bash
npx npm@8 install
copy .env.example .env
npm run dev
```

Open the client at `http://localhost:5173`.

## Configuration

- Put your TomTom key in `.env` as `TOMTOM_API_KEY`.
- Profiles are stored locally in SQLite at `data/dashboard.sqlite`.
- Bus setup starts from route number, then loads directions and stop-name choices. The app hides official stop IDs in the UI but stores them internally because the ETA APIs require them.
- Co-operated routes can merge operators such as KMB + Citybus and keep each operator's own direction/stop IDs behind one visible route direction.
- MTR setup uses MTR line/station codes plus average ride/interchange minutes; walking time is intentionally excluded.

## Scripts

```bash
npm run dev        # Fastify API + Vite client
npm run build      # TypeScript server + production client bundle
npm test           # Build server and run core time/ETA pairing tests
npm run start      # Start built API server
```
