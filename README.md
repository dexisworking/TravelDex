# TravelDex

TravelDex is a single-origin Express app that serves the frontend and proxies all Gemini, Geocoding, Places, and Routes requests through the backend.

## Before uploading to GitHub

1. Keep real secrets only in `.env` (already ignored by git).
2. Keep placeholders in `.env.example` only.
3. Rotate any API keys that were ever exposed in logs/screenshots/old commits.

## Local setup

1. Copy `.env.example` to `.env`.
2. Add your Gemini key and Google Maps key(s).
3. Install dependencies:

```bash
npm install
```

4. Start the app:

```bash
npm start
```

The app will be available at `http://localhost:3000`.

## Scripts

- `npm start`: builds the generated Tailwind CSS and starts the server
- `npm run build`: rebuilds the generated Tailwind CSS
- `npm run check`: syntax-checks `server.js`

## Deployment notes

- Required env vars: `GEMINI_API_KEY`, `GOOGLE_MAPS_API_KEY`
- Recommended env vars: `GOOGLE_MAPS_SERVER_API_KEY`, `GOOGLE_MAPS_MAP_ID`
- Optional env vars: `PORT`, `GEMINI_MODEL`
- Health check endpoint: `/health`

If you use separate Google keys, keep the browser key in `GOOGLE_MAPS_API_KEY` and put the server-side Places/Routes/Geocoding key in `GOOGLE_MAPS_SERVER_API_KEY`.
