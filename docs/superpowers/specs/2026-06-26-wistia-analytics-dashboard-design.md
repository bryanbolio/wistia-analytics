# Wistia Analytics Dashboard — Design Spec
**Date:** 2026-06-26
**Project:** `wistia-analytics`
**Owner:** Bryan Bolio, Customer Education Manager, DoorLoop

---

## Overview

A locally-run / DeployBay-deployed web dashboard that pulls live data from the Wistia API and displays video performance metrics across the DoorLoop Training Hub video library. The goal is to quickly identify which videos are performing well vs. which need attention — faster and in more bulk than Wistia's native interface allows.

---

## Architecture

**Stack:** Node.js + Express backend, vanilla HTML/CSS/JS frontend. No build step. No framework. Modular file structure.

**Deployment:** Direct push to DeployBay (no GitHub repo). Dockerfile included for container build.

### File Structure

```
wistia-analytics/
├── server.js           # Express entry point + route definitions + threshold constants
├── lib/
│   ├── wistia.js       # All Wistia API calls, batch fetching, TIMELINE_DAYS constant
│   └── cache.js        # Disk read/write only (no TTL logic)
├── public/
│   ├── index.html      # Page shell and markup
│   ├── app.js          # All frontend JS: state, rendering, chart, events
│   └── styles.css      # All styles
├── package.json        # Express dependency only
├── Dockerfile
├── .dockerignore
└── .gitignore
```

---

## Data Flow

1. **Page load** → frontend calls `GET /api/stats` → server returns in-memory cache (if populated) or reads from `cache.json` → returns data
2. **No cache file** → server fetches fresh from Wistia, writes to disk, returns data
3. **Refresh button** → frontend calls `GET /api/refresh` → server force-fetches from Wistia, overwrites disk cache, updates in-memory copy, returns fresh data

Cache is **manual-refresh-only**. No TTL, no auto-expiry. The dashboard shows a "Last updated: [timestamp]" so Bryan knows exactly how old the data is and decides when to refresh.

---

## Wistia API

**Project hashed ID:** `stce6aea96`
**Base URL:** `https://api.wistia.com/v1/`
**Auth:** `Bearer` token via `WISTIA_API_TOKEN` env var

### Endpoints Used

| Step | Endpoint | Purpose |
|---|---|---|
| 1 | `GET /projects/stce6aea96/medias.json` | Fetch full video list (hashed ID, title, duration, thumbnail, created date) |
| 2 | `GET /stats/medias/{hashed_id}.json` (×N) | Per-video aggregate stats |
| 3 | `GET /medias/{hashed_id}/timeline.json` (×N) | Per-video daily play counts |

Steps 2 and 3 run concurrently per video. All videos fetched in batches of 10 with a small delay between batches to stay within rate limits.

**Note on section groupings:** The Wistia project medias API returns a `section` field on each video reflecting how videos are organized into sections/folders within the Wistia project. The dashboard uses this field directly for the section filter, section badge on cards, and the By Section rollup table. If a video has no section assigned in Wistia, it appears under "Unsectioned." Section names in the dashboard will exactly match how Bryan has organized them in Wistia.

---

## Metrics

### Per-Video (all surfaced in UI)

| Metric | Source | Notes |
|---|---|---|
| Plays | Stats API | Total play count |
| Unique Visitors | Stats API | Unique viewer count |
| Play Rate | Stats API | % of page loads where viewer clicked play |
| Avg Engagement | Stats API | % of video watched per play — drives flag |
| Page Loads | Stats API | Times the embed loaded |
| Hours Watched | Derived | `plays × duration × engagement ÷ 3600` |
| Duration | Medias API | Video length in seconds |

### Project-Level KPIs (aggregated across all videos)

Total Plays · Unique Visitors · Avg Engagement · Total Hours Watched · Avg Play Rate · Total Page Loads

---

## Cache File (`cache.json`)

```json
{
  "fetchedAt": 1719446400000,
  "projectId": "stce6aea96",
  "videos": [
    {
      "hashedId": "abc123",
      "name": "Welcome to DoorLoop",
      "duration": 94,
      "thumbnail": "https://...",
      "createdAt": "2024-01-15T...",
      "stats": {
        "plays": 312,
        "visitors": 289,
        "playRate": 0.74,
        "engagement": 0.68,
        "pageLoads": 391,
        "hoursWatched": 5.5
      },
      "timeline": [
        { "date": "2026-05-27", "plays": 4 },
        { "date": "2026-05-28", "plays": 7 }
      ]
    }
  ]
}
```

`cache.json` is excluded from `.gitignore` and `.dockerignore` — never committed or baked into the image. Generated fresh at runtime on first Refresh.

---

## Frontend Layout

```
┌──────────────────────────────────────────────────────────┐
│  Training Hub · Video Analytics     Last updated: Jun 26 │
│                                              [Refresh]    │
├──────────────────────────────────────────────────────────┤
│  KPI STRIP: Plays │ Visitors │ Engagement │ Hours │ Play Rate │ Page Loads │
├──────────────────────────────────────────────────────────┤
│  FILTER BAR: [Section ▼] [Search…] [Sort by ▼] [↓]       │
├──────────────────────────────────────────────────────────┤
│  VIDEO CARDS (3-column grid)                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │ Card     │ │ Card     │ │ Card ⚠   │  ← underperform │
│  └──────────┘ └──────────┘ └──────────┘                 │
├──────────────────────────────────────────────────────────┤
│  BY SECTION (sortable table)                             │
├──────────────────────────────────────────────────────────┤
│  TREND CHART                                             │
│  Date range: [Last 30 days ▼]  Videos: [multi-select]   │
│  [Line chart — daily plays per selected video]           │
└──────────────────────────────────────────────────────────┘
```

### Video Card

- Title + section badge
- All 6 metrics listed
- Engagement progress bar: green ≥50%, yellow 35–50%, red <35%
- ⚠ underperforming badge when engagement < `bad` threshold
- "Open in Wistia ↗" link

### Trend Chart Panel

- Chart.js (CDN script tag — only external dependency)
- Multi-select video picker with title search
- Date range: Last 30 days (default) / Last 60 days / Last 90 days
- Line chart, one line per selected video, daily plays on Y axis
- Reads from already-loaded cache — zero additional API calls

### Empty State (no cache file)

Centered message + prominent Refresh button: "Click Refresh to pull your Training Hub data from Wistia for the first time."

---

## Underperforming Flag

Engagement-primary. Configurable thresholds as named constants in `server.js`, passed to the frontend via the `/api/stats` response:

```js
const THRESHOLDS = {
  engagement: { warn: 0.50, bad: 0.35 }
};
```

Cards below `bad` receive the ⚠ badge. Cards below `warn` but above `bad` show yellow bar only.

---

## Caching Strategy

**`lib/cache.js` responsibilities:**
- `read()` — parse `cache.json` from disk, return object or `null` if file doesn't exist
- `write(data)` — write object to `cache.json` as formatted JSON

**`server.js` holds an in-memory copy** after first read, so requests don't hit disk. In-memory and disk are always updated together during Refresh.

**Cache file location:** `./cache.json` by default, overridable via `CACHE_FILE` env var.

---

## Backend Routes

| Method | Route | Behavior |
|---|---|---|
| `GET` | `/api/stats` | Return in-memory cache (or load from disk if cold start) |
| `GET` | `/api/refresh` | Force-fetch from Wistia, write to disk, return fresh data |
| `GET` | `/*` | Serve `public/` static files |

---

## Dockerfile

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY server.js .
COPY lib/ ./lib/
COPY public/ ./public/
EXPOSE 3000
CMD ["node", "server.js"]
```

Layer order ensures `npm install` only re-runs when `package.json` changes.

## .dockerignore

```
node_modules/
.env
cache.json
.git/
.DS_Store
*.log
```

---

## Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `WISTIA_API_TOKEN` | Yes | — | Set in DeployBay, never hardcoded |
| `PORT` | No | `3000` | DeployBay sets this automatically |
| `CACHE_FILE` | No | `./cache.json` | Override if DeployBay requires specific path |

---

## Configurable Constants

| Constant | File | Default | Purpose |
|---|---|---|---|
| `TIMELINE_DAYS` | `lib/wistia.js` | `30` | Days of timeline data fetched per video |
| `BATCH_SIZE` | `lib/wistia.js` | `10` | Videos fetched per batch |
| `THRESHOLDS.engagement.warn` | `server.js` | `0.50` | Yellow flag threshold |
| `THRESHOLDS.engagement.bad` | `server.js` | `0.35` | Red/⚠ flag threshold |
