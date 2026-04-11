# TravelDex

TravelDex is an AI-assisted trip planning web app powered by Gemini and Google Maps APIs.  
It runs as a single Express server that serves the frontend and proxies API requests so keys are managed on the backend.

![TravelDex UI](public/TravelDex.png)

## Features

- AI itinerary generation with Gemini (`/api/gemini/generateContent`)
- Place text search, nearby search, and place details (Google Places)
- Address/coordinate geocoding (Google Geocoding)
- Route computation with optional waypoint optimization (Google Routes)
- Health endpoint for deployment checks (`/health`)

## Tech stack

- Node.js + Express
- Vanilla frontend served from `public/`
- Tailwind CSS build pipeline
- Google Maps Platform + Gemini API integration

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Create local environment file:

```bash
copy .env.example .env
```

3. Fill real API keys in `.env`.
4. Build frontend CSS:

```bash
npm run build
```

5. Start the server:

```bash
npm start
```

App runs at `http://localhost:3000`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Gemini content generation |
| `GOOGLE_MAPS_API_KEY` | Yes | Browser key used by Maps JavaScript API |
| `GOOGLE_MAPS_SERVER_API_KEY` | Recommended | Server-side key for Places/Routes/Geocoding (falls back to `GOOGLE_MAPS_API_KEY`) |
| `GEMINI_MODEL` | Optional | Defaults to `gemini-2.5-flash` |
| `GOOGLE_MAPS_MAP_ID` | Optional | Defaults to `DEMO_MAP_ID` |
| `PORT` | Optional | Server port (default `3000`) |

## Scripts

- `npm run build` - rebuild Tailwind output (`public/tailwind.generated.css`)
- `npm start` - run prestart build, then launch Express server
- `npm run dev` - start server without prestart script
- `npm run check` - syntax check `server.js`

## API surface

- `GET /health`
- `GET /api/config`
- `POST /api/gemini/generateContent`
- `POST /api/maps/search-text`
- `POST /api/maps/nearby`
- `GET /api/maps/place-details/:placeId`
- `GET /api/maps/geocode`
- `POST /api/maps/route`

## Security notes

- Keep real keys only in `.env` (already git-ignored).
- Commit placeholders only in `.env.example`.
- If any keys were ever exposed in history, rotate them before making the repository public.
