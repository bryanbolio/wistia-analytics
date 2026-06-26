# Wistia Analytics Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js/Express web dashboard that fetches DoorLoop Training Hub video metrics from the Wistia API, caches them to disk, and displays them with sorting, filtering, and a trend chart.

**Architecture:** Express backend serves two API routes (`/api/stats` and `/api/refresh`) plus static files from `public/`. A flat JSON file (`cache.json`) persists all data between server restarts. Frontend is vanilla HTML/CSS/JS. Chart.js (CDN) handles the trend chart. All Wistia API calls happen in `lib/wistia.js`; disk I/O is isolated in `lib/cache.js`.

**Tech Stack:** Node.js 18 LTS · Express 4.x · dotenv 16.x · Chart.js 4.x (CDN only, no install) · node:test (built-in, for unit tests)

## Global Constraints

- No git repository — direct-push DeployBay deployment
- No build step, no framework, no transpilation
- `WISTIA_API_TOKEN` must never appear in source files — env var only
- Wistia project hashed ID (hardcoded in `lib/wistia.js`): `stce6aea96`
- All JS files must pass `node --check` before each task is marked complete
- Dockerfile base: `node:18-alpine`; uses `npm install --production`
- Cache is manual-refresh-only — no TTL, no auto-expiry
- Chart.js loaded via CDN `<script>` tag in `index.html`
- `TIMELINE_DAYS = 90` (fetch 90 days of timeline data per Refresh so all chart range options — 30/60/90 days — always have full data; the chart UI defaults to displaying the last 30 days)
- dotenv is a production dependency (not devDependency) — harmless no-op in Docker where no `.env` file exists

---

## File Map

| File | Created/Modified | Responsibility |
|---|---|---|
| `package.json` | Create | Express + dotenv dependencies, start script |
| `.env` | Create | Local dev token (gitignored, never committed) |
| `.gitignore` | Create | Excludes node_modules, .env, cache.json |
| `lib/cache.js` | Create | `read(filePath)` and `write(filePath, data)` only |
| `lib/wistia.js` | Create | All Wistia API calls, batching, `buildVideoObject` |
| `server.js` | Create | Express entry, routes, `THRESHOLDS` constant |
| `public/styles.css` | Create | All CSS — variables, layout, cards, table, chart panel |
| `public/index.html` | Create | Page shell, Chart.js CDN script, links to app.js/styles.css |
| `public/app.js` | Create | Full frontend: state, render, chart, events |
| `tests/cache.test.js` | Create | Unit tests for cache.js |
| `tests/wistia.test.js` | Create | Unit tests for buildVideoObject |
| `Dockerfile` | Create | Production container definition |
| `.dockerignore` | Create | Excludes node_modules, .env, cache.json, tests/, docs/ |

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `.env`
- Create: `.gitignore`
- Create (dirs): `lib/`, `public/`, `tests/`

**Interfaces:**
- Consumes: nothing
- Produces: `require('express')` resolves; `require('dotenv').config()` loads `.env`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p wistia-analytics/lib wistia-analytics/public wistia-analytics/tests
cd wistia-analytics
```

- [ ] **Step 2: Write package.json**

```json
{
  "name": "wistia-analytics",
  "version": "1.0.0",
  "description": "Training Hub video analytics dashboard",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test tests/"
  },
  "dependencies": {
    "express": "^4.18.2",
    "dotenv": "^16.3.1"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created. No warnings about missing packages.

- [ ] **Step 4: Write .env**

```
WISTIA_API_TOKEN=your_wistia_api_token_here
PORT=3000
```

Replace `your_wistia_api_token_here` with the actual Wistia API token.

- [ ] **Step 5: Write .gitignore**

```
node_modules/
.env
cache.json
.DS_Store
*.log
```

---

### Task 2: lib/cache.js — Disk Cache Module

**Files:**
- Create: `lib/cache.js`
- Create: `tests/cache.test.js`

**Interfaces:**
- Consumes: Node.js built-in `fs` module
- Produces:
  - `cache.read(filePath: string): object | null` — returns parsed JSON or `null` on any failure
  - `cache.write(filePath: string, data: object): void` — writes formatted JSON to disk

- [ ] **Step 1: Write the failing tests**

Create `tests/cache.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cache = require('../lib/cache');

const tmpFile = path.join(os.tmpdir(), `cache-test-${process.pid}.json`);

test('read returns null when file does not exist', () => {
  const result = cache.read('/tmp/nonexistent-cache-file-99999.json');
  assert.strictEqual(result, null);
});

test('write creates file and read returns the same data', () => {
  const data = { fetchedAt: 1719446400000, videos: [{ hashedId: 'abc' }] };
  cache.write(tmpFile, data);
  const result = cache.read(tmpFile);
  assert.deepStrictEqual(result, data);
  fs.unlinkSync(tmpFile);
});

test('read returns null when file contains invalid JSON', () => {
  fs.writeFileSync(tmpFile, 'not valid json { ]', 'utf8');
  const result = cache.read(tmpFile);
  assert.strictEqual(result, null);
  fs.unlinkSync(tmpFile);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test tests/cache.test.js
```

Expected: `Error: Cannot find module '../lib/cache'`

- [ ] **Step 3: Write lib/cache.js**

```js
const fs = require('fs');

function read(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function write(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { read, write };
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
node --test tests/cache.test.js
```

Expected:
```
✔ read returns null when file does not exist
✔ write creates file and read returns the same data
✔ read returns null when file contains invalid JSON
```

- [ ] **Step 5: Syntax check**

```bash
node --check lib/cache.js
```

Expected: no output.

---

### Task 3: lib/wistia.js — Wistia API Client

**Files:**
- Create: `lib/wistia.js`
- Create: `tests/wistia.test.js`

**Interfaces:**
- Consumes: Node.js built-in `fetch` (native in Node 18+)
- Produces:
  - `wistia.fetchAll(token: string, timelineDays?: number): Promise<VideoObject[]>`
  - `wistia.buildVideoObject(media: object, stats: object|null, timeline: array|null, error?: string): VideoObject`

**VideoObject shape** (used by server.js and app.js):
```js
{
  hashedId:  string,
  name:      string,
  section:   string,        // Wistia section field, or 'Unsectioned'
  duration:  number,        // seconds
  thumbnail: string | null,
  createdAt: string,
  stats: {
    plays:        number,
    visitors:     number,
    playRate:     number,   // 0–1
    engagement:   number,   // 0–1, average % of video watched
    pageLoads:    number,
    hoursWatched: number    // derived: plays × duration × engagement ÷ 3600
  } | null,
  timeline: Array<{ date: string, plays: number }>,
  error: string | null
}
```

- [ ] **Step 1: Write the failing tests**

Create `tests/wistia.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildVideoObject } = require('../lib/wistia');

const sampleMedia = {
  hashed_id: 'abc123',
  name: 'Welcome to DoorLoop',
  section: 'Dashboard',
  duration: 120,
  thumbnail: { url: 'https://example.com/thumb.jpg' },
  created: '2024-01-15T00:00:00Z'
};

const sampleStats = {
  plays: 100,
  visitors: 80,
  percentOfVisitorsClickingPlay: 0.75,
  averagePercentWatched: 0.65,
  pageLoads: 107
};

const sampleTimeline = [
  { date: '2026-06-01', plays: 5 },
  { date: '2026-06-02', plays: 3 }
];

test('buildVideoObject maps all top-level fields', () => {
  const result = buildVideoObject(sampleMedia, sampleStats, sampleTimeline);
  assert.strictEqual(result.hashedId, 'abc123');
  assert.strictEqual(result.name, 'Welcome to DoorLoop');
  assert.strictEqual(result.section, 'Dashboard');
  assert.strictEqual(result.duration, 120);
  assert.strictEqual(result.thumbnail, 'https://example.com/thumb.jpg');
  assert.strictEqual(result.error, null);
});

test('buildVideoObject maps stats fields', () => {
  const result = buildVideoObject(sampleMedia, sampleStats, sampleTimeline);
  assert.strictEqual(result.stats.plays, 100);
  assert.strictEqual(result.stats.visitors, 80);
  assert.strictEqual(result.stats.playRate, 0.75);
  assert.strictEqual(result.stats.engagement, 0.65);
  assert.strictEqual(result.stats.pageLoads, 107);
});

test('buildVideoObject computes hoursWatched from plays × duration × engagement', () => {
  const result = buildVideoObject(sampleMedia, sampleStats, sampleTimeline);
  const expected = (100 * 120 * 0.65) / 3600;
  assert.ok(Math.abs(result.stats.hoursWatched - expected) < 0.0001);
});

test('buildVideoObject accepts play_count field in timeline', () => {
  const tlAlt = [{ date: '2026-06-01', play_count: 7 }];
  const result = buildVideoObject(sampleMedia, sampleStats, tlAlt);
  assert.strictEqual(result.timeline[0].plays, 7);
});

test('buildVideoObject defaults section to Unsectioned when missing', () => {
  const mediaNoSection = { ...sampleMedia, section: null };
  const result = buildVideoObject(mediaNoSection, sampleStats, sampleTimeline);
  assert.strictEqual(result.section, 'Unsectioned');
});

test('buildVideoObject handles error state — stats is null', () => {
  const result = buildVideoObject(sampleMedia, null, null, 'API timeout');
  assert.strictEqual(result.stats, null);
  assert.strictEqual(result.error, 'API timeout');
  assert.deepStrictEqual(result.timeline, []);
});

test('buildVideoObject handles nested stats.stats shape', () => {
  const nestedStats = { stats: { ...sampleStats } };
  const result = buildVideoObject(sampleMedia, nestedStats, sampleTimeline);
  assert.strictEqual(result.stats.plays, 100);
  assert.strictEqual(result.stats.engagement, 0.65);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test tests/wistia.test.js
```

Expected: `Error: Cannot find module '../lib/wistia'`

- [ ] **Step 3: Write lib/wistia.js**

```js
const PROJECT_ID = 'stce6aea96';
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 150;
const TIMELINE_DAYS = 90; // fetch 90 days so all chart range options (30/60/90) always have data

const WISTIA_API = 'https://api.wistia.com/v1';

async function wistiaGet(path, token) {
  const res = await fetch(`${WISTIA_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Wistia API ${res.status}: ${path}`);
  return res.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function num(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    const n = typeof v === 'string' ? parseFloat(v) : Number(v);
    if (!isNaN(n)) return n;
  }
  return 0;
}

function buildVideoObject(media, stats, timeline, error = null) {
  // Wistia stats API sometimes nests under .stats, sometimes returns flat
  const s = (stats && stats.stats) ? stats.stats : (stats || {});
  const plays      = num(s.plays);
  const engagement = num(s.averagePercentWatched);
  const duration   = num(media.duration);

  return {
    hashedId:  media.hashed_id,
    name:      media.name,
    section:   media.section || 'Unsectioned',
    duration,
    thumbnail: media.thumbnail?.url ?? null,
    createdAt: media.created,
    stats: error ? null : {
      plays,
      visitors:     num(s.visitors),
      playRate:     num(s.percentOfVisitorsClickingPlay),
      engagement,
      pageLoads:    num(s.pageLoads, s.page_loads),
      hoursWatched: duration > 0 ? (plays * duration * engagement) / 3600 : 0
    },
    timeline: Array.isArray(timeline)
      ? timeline.map(t => ({ date: t.date, plays: num(t.plays, t.play_count) }))
      : [],
    error: error || null
  };
}

async function fetchVideoData(hashedId, token, timelineDays) {
  const end   = isoDate(new Date());
  const start = isoDate(new Date(Date.now() - timelineDays * 24 * 60 * 60 * 1000));

  const [stats, timeline] = await Promise.all([
    wistiaGet(`/stats/medias/${hashedId}.json`, token),
    wistiaGet(`/medias/${hashedId}/timeline.json?start_date=${start}&end_date=${end}`, token)
  ]);

  return { stats, timeline };
}

async function fetchAll(token, timelineDays = TIMELINE_DAYS) {
  const medias = await wistiaGet(`/projects/${PROJECT_ID}/medias.json`, token);
  const videos = medias.filter(m => m.type === 'Video');
  const results = [];

  for (let i = 0; i < videos.length; i += BATCH_SIZE) {
    const batch = videos.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (media) => {
      try {
        const { stats, timeline } = await fetchVideoData(media.hashed_id, token, timelineDays);
        return buildVideoObject(media, stats, timeline);
      } catch (err) {
        return buildVideoObject(media, null, null, err.message);
      }
    }));
    results.push(...batchResults);
    if (i + BATCH_SIZE < videos.length) await sleep(BATCH_DELAY_MS);
  }

  return results;
}

module.exports = { fetchAll, buildVideoObject };
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
node --test tests/wistia.test.js
```

Expected:
```
✔ buildVideoObject maps all top-level fields
✔ buildVideoObject maps stats fields
✔ buildVideoObject computes hoursWatched from plays × duration × engagement
✔ buildVideoObject accepts play_count field in timeline
✔ buildVideoObject defaults section to Unsectioned when missing
✔ buildVideoObject handles error state — stats is null
✔ buildVideoObject handles nested stats.stats shape
```

- [ ] **Step 5: Syntax check**

```bash
node --check lib/wistia.js
```

Expected: no output.

---

### Task 4: server.js — Express Routes

**Files:**
- Create: `server.js`

**Interfaces:**
- Consumes:
  - `cache.read(filePath: string): object | null`
  - `cache.write(filePath: string, data: object): void`
  - `wistia.fetchAll(token: string, timelineDays?: number): Promise<VideoObject[]>`
- Produces:
  - `GET /api/stats` → `{ fetchedAt, projectId, videos, thresholds, cached }`
  - `GET /api/refresh` → same shape, always fetches fresh
  - `GET /*` → static files from `public/`

- [ ] **Step 1: Write server.js**

```js
require('dotenv').config();
const express = require('express');
const path = require('path');
const { fetchAll } = require('./lib/wistia');
const cache = require('./lib/cache');

const app = express();
const PORT       = process.env.PORT || 3000;
const CACHE_FILE = process.env.CACHE_FILE || path.join(__dirname, 'cache.json');

const THRESHOLDS = {
  engagement: { warn: 0.50, bad: 0.35 }
};

let inMemoryCache = null;

async function getStats({ force = false } = {}) {
  if (!force && inMemoryCache) {
    return { ...inMemoryCache, cached: true };
  }

  if (!force) {
    const disk = cache.read(CACHE_FILE);
    if (disk) {
      inMemoryCache = disk;
      return { ...disk, cached: true };
    }
  }

  const token = process.env.WISTIA_API_TOKEN;
  if (!token) throw new Error('WISTIA_API_TOKEN env var is not set');

  const videos = await fetchAll(token);
  const data = { fetchedAt: Date.now(), projectId: 'stce6aea96', videos };
  cache.write(CACHE_FILE, data);
  inMemoryCache = data;
  return { ...data, cached: false };
}

app.get('/api/stats', async (req, res) => {
  try {
    const result = await getStats();
    res.json({ ...result, thresholds: THRESHOLDS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/refresh', async (req, res) => {
  try {
    const result = await getStats({ force: true });
    res.json({ ...result, thresholds: THRESHOLDS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`wistia-analytics listening on :${PORT}`);
  if (!process.env.WISTIA_API_TOKEN) {
    console.warn('WARNING: WISTIA_API_TOKEN is not set — API routes will return 500');
  }
});
```

- [ ] **Step 2: Syntax check**

```bash
node --check server.js
```

Expected: no output.

- [ ] **Step 3: Smoke test routes**

```bash
node server.js &
curl -s http://localhost:3000/api/stats
```

Expected (no token in env): `{"error":"WISTIA_API_TOKEN env var is not set"}`

```bash
kill %1
```

---

### Task 5: public/styles.css

**Files:**
- Create: `public/styles.css`

**Interfaces:**
- Produces: All CSS custom properties and classes used by `index.html` and HTML generated by `app.js`

- [ ] **Step 1: Write public/styles.css**

```css
:root {
  --bg:       #0D1117;
  --surface:  #161C26;
  --surface2: #1C2435;
  --border:   #2A3347;
  --text:     #CDD5E0;
  --heading:  #EEF2FF;
  --muted:    #7D8BA5;
  --accent:   #4F74FF;
  --good:     #22C55E;
  --warn:     #F59E0B;
  --bad:      #EF4444;
}

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0; padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 28px 24px 80px;
}

/* ── Header ── */
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 28px;
}
.app-header h1 {
  font-size: 20px;
  font-weight: 700;
  color: var(--heading);
  margin: 0;
  letter-spacing: -0.02em;
}
.app-header h1 .dot { color: var(--muted); font-weight: 400; margin: 0 8px; }
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--muted);
  font-size: 13px;
}

/* ── Buttons ── */
.btn {
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 7px 14px;
  border-radius: 7px;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn:hover { opacity: 0.85; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary { background: var(--accent); color: #fff; }
.btn-ghost { background: transparent; color: var(--text); border: 1px solid var(--border); }

/* ── KPI Strip ── */
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}
.kpi {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
}
.kpi-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 5px;
}
.kpi-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--heading);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

/* ── Filter Bar ── */
.filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  margin-bottom: 18px;
}
.filter-label { font-size: 12px; color: var(--muted); }
.filter-select,
.filter-input {
  background: var(--surface2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.filter-select:focus,
.filter-input:focus { border-color: var(--accent); }
.filter-input { min-width: 180px; }
.sort-btn {
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 10px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--surface2);
  color: var(--muted);
  cursor: pointer;
  transition: all 0.1s;
}
.sort-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.sort-dir-btn {
  width: 28px; height: 28px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--surface2);
  color: var(--text);
  cursor: pointer;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-family: inherit;
}

/* ── Video Grid ── */
.video-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 32px;
}

/* ── Video Card ── */
.video-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: fadein 0.2s ease-out;
}
.video-card.has-error { opacity: 0.5; }
.video-card.flagged { border-color: rgba(239,68,68,0.4); }
@keyframes fadein {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: translateY(0); }
}
.card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.section-badge {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
  background: var(--surface2);
  border: 1px solid var(--border);
  padding: 2px 7px;
  border-radius: 999px;
}
.flag-badge {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--bad);
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.3);
  padding: 2px 7px;
  border-radius: 999px;
  white-space: nowrap;
}
.video-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--heading);
  margin: 0;
  line-height: 1.35;
  letter-spacing: -0.01em;
}
.metrics { display: flex; flex-direction: column; gap: 5px; }
.metric-row { display: flex; justify-content: space-between; font-size: 12.5px; }
.metric-name { color: var(--muted); }
.metric-val  { color: var(--text); font-variant-numeric: tabular-nums; }
.engagement-bar {
  height: 5px;
  background: var(--surface2);
  border-radius: 999px;
  overflow: hidden;
}
.engagement-bar .fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease;
}
.fill-good { background: var(--good); }
.fill-warn { background: var(--warn); }
.fill-bad  { background: var(--bad);  }
.card-link { font-size: 12px; color: var(--accent); text-decoration: none; margin-top: auto; }
.card-link:hover { text-decoration: underline; }
.card-error-msg { font-size: 12px; color: var(--muted); font-style: italic; }

/* ── Section Table ── */
.section-block { margin-bottom: 32px; }
.block-heading {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 12px;
}
.data-table-wrap { overflow-x: auto; }
.data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.data-table th {
  background: var(--surface2);
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 9px 13px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.data-table th .sort-arrow { color: var(--accent); margin-left: 4px; }
.data-table td {
  padding: 9px 13px;
  border-top: 1px solid var(--border);
  color: var(--text);
}
.data-table tbody tr:first-child td { border-top: none; }
.data-table tbody tr { cursor: pointer; }
.data-table tbody tr:hover td { background: var(--surface2); }
.data-table tbody tr.row-active td { background: rgba(79,116,255,0.07); }

/* ── Chart Panel ── */
.chart-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 32px;
}
.chart-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}
.chart-label { font-size: 12px; color: var(--muted); font-weight: 500; }
.chart-select {
  background: var(--surface2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.chart-select:focus { border-color: var(--accent); }
.video-picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; }
.picker-chip {
  font-family: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface2);
  color: var(--muted);
  cursor: pointer;
  transition: all 0.1s;
}
.picker-chip.selected { background: var(--accent); color: #fff; border-color: var(--accent); }
.chart-canvas-wrap { position: relative; height: 280px; }
.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--muted);
  font-size: 13px;
}

/* ── States ── */
.state-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  color: var(--muted);
  text-align: center;
  gap: 12px;
}
.spinner {
  width: 26px; height: 26px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.85s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.state-heading { font-size: 16px; font-weight: 600; color: var(--heading); margin: 0; }
.state-sub { margin: 0; font-size: 13px; }

/* ── Responsive ── */
@media (max-width: 1200px) {
  .video-grid { grid-template-columns: repeat(2, 1fr); }
  .kpi-strip  { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 700px) {
  .video-grid { grid-template-columns: 1fr; }
  .kpi-strip  { grid-template-columns: repeat(2, 1fr); }
}
```

---

### Task 6: public/index.html — Page Shell

**Files:**
- Create: `public/index.html`

**Interfaces:**
- Consumes: `public/styles.css`, `public/app.js`, Chart.js 4.4.3 from CDN
- Produces: DOM with `#root` div and `#refresh-btn`, scripts loaded after body

- [ ] **Step 1: Write public/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Training Hub · Video Analytics</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="container">
    <header class="app-header">
      <h1>Training Hub <span class="dot">·</span> Video Analytics</h1>
      <div class="header-right">
        <span id="last-updated"></span>
        <button id="refresh-btn" class="btn btn-ghost">Refresh</button>
      </div>
    </header>
    <div id="root"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Start server and verify page loads**

```bash
node server.js
```

Open `http://localhost:3000`. Expected: page renders with the header and a spinner in `#root` (data fetch will fail until app.js exists — that's fine at this step).

---

### Task 7: public/app.js — Full Frontend

**Files:**
- Create: `public/app.js`

**Interfaces:**
- Consumes:
  - `GET /api/stats` → `{ videos: VideoObject[], thresholds, fetchedAt }`
  - `GET /api/refresh` → same shape
  - `Chart` global from Chart.js CDN
- Produces: Full rendered dashboard — KPI strip, filter bar, video card grid, section table, trend chart panel

- [ ] **Step 1: Write public/app.js**

```js
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  const S = {
    videos:        [],
    thresholds:    { engagement: { warn: 0.50, bad: 0.35 } },
    fetchedAt:     null,
    section:       'all',
    sortBy:        'plays',
    sortDir:       'desc',
    search:        '',
    sectionSortBy:  'plays',
    sectionSortDir: 'desc',
    chartVideos:   [],
    chartDays:     30,
    chartInstance: null
  };

  const SORT_OPTIONS = [
    { key: 'plays',      label: 'Plays' },
    { key: 'visitors',   label: 'Visitors' },
    { key: 'engagement', label: 'Engagement' },
    { key: 'playRate',   label: 'Play Rate' },
    { key: 'pageLoads',  label: 'Page Loads' },
    { key: 'hours',      label: 'Hours' }
  ];

  const SECTION_COLS = [
    { key: 'name',       label: 'Section' },
    { key: 'count',      label: 'Videos' },
    { key: 'plays',      label: 'Total Plays' },
    { key: 'engagement', label: 'Avg Engagement' },
    { key: 'hours',      label: 'Hours Watched' }
  ];

  const CHART_COLORS = [
    '#4F74FF','#22C55E','#F59E0B','#EF4444','#A78BFA',
    '#34D399','#FB7185','#60A5FA','#FBBF24','#818CF8'
  ];

  // ── Formatters ─────────────────────────────────────────────────────────────
  function fmtInt(n)   { return (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US'); }
  function fmtPct(n)   { return (n == null || isNaN(n)) ? '—' : (n * 100).toFixed(1) + '%'; }
  function fmtHours(h) {
    if (h == null || isNaN(h)) return '—';
    return h < 1 ? Math.round(h * 60) + 'm' : h.toFixed(1) + 'h';
  }
  function fmtTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // ── Metric helpers ─────────────────────────────────────────────────────────
  function metricVal(video, key) {
    const st = video.stats;
    if (!st) return -Infinity;
    if (key === 'plays')      return st.plays        ?? -Infinity;
    if (key === 'visitors')   return st.visitors     ?? -Infinity;
    if (key === 'engagement') return st.engagement   ?? -Infinity;
    if (key === 'playRate')   return st.playRate      ?? -Infinity;
    if (key === 'pageLoads')  return st.pageLoads    ?? -Infinity;
    if (key === 'hours')      return st.hoursWatched ?? -Infinity;
    return -Infinity;
  }

  function engClass(eng) {
    if (eng == null) return 'fill-bad';
    if (eng >= S.thresholds.engagement.warn) return 'fill-good';
    if (eng >= S.thresholds.engagement.bad)  return 'fill-warn';
    return 'fill-bad';
  }

  function isFlagged(video) {
    return video.stats != null && video.stats.engagement < S.thresholds.engagement.bad;
  }

  // ── Render: KPI Strip ──────────────────────────────────────────────────────
  function renderKPIs(videos) {
    let plays = 0, visitors = 0, hours = 0, loads = 0;
    let engSum = 0, engN = 0, rateSum = 0, rateN = 0;
    videos.forEach(v => {
      const s = v.stats;
      if (!s) return;
      plays    += s.plays        || 0;
      visitors += s.visitors     || 0;
      hours    += s.hoursWatched || 0;
      loads    += s.pageLoads    || 0;
      if (s.engagement != null) { engSum  += s.engagement; engN++; }
      if (s.playRate   != null) { rateSum += s.playRate;   rateN++; }
    });
    return `
      <div class="kpi-strip">
        <div class="kpi"><div class="kpi-label">Total Plays</div><div class="kpi-value">${fmtInt(plays)}</div></div>
        <div class="kpi"><div class="kpi-label">Unique Visitors</div><div class="kpi-value">${fmtInt(visitors)}</div></div>
        <div class="kpi"><div class="kpi-label">Avg Engagement</div><div class="kpi-value">${fmtPct(engN ? engSum / engN : null)}</div></div>
        <div class="kpi"><div class="kpi-label">Hours Watched</div><div class="kpi-value">${fmtHours(hours)}</div></div>
        <div class="kpi"><div class="kpi-label">Avg Play Rate</div><div class="kpi-value">${fmtPct(rateN ? rateSum / rateN : null)}</div></div>
        <div class="kpi"><div class="kpi-label">Page Loads</div><div class="kpi-value">${fmtInt(loads)}</div></div>
      </div>`;
  }

  // ── Render: Filter Bar ─────────────────────────────────────────────────────
  function renderFilterBar(sections) {
    const sectionOpts = ['<option value="all">All sections</option>']
      .concat(sections.map(s =>
        `<option value="${escHtml(s)}"${S.section === s ? ' selected' : ''}>${escHtml(s)}</option>`
      )).join('');

    const sortBtns = SORT_OPTIONS.map(o =>
      `<button class="sort-btn${S.sortBy === o.key ? ' active' : ''}" data-sort="${o.key}">${o.label}</button>`
    ).join('');

    return `
      <div class="filter-bar">
        <span class="filter-label">Section:</span>
        <select class="filter-select" id="section-sel">${sectionOpts}</select>
        <span class="filter-label" style="margin-left:6px">Sort:</span>
        ${sortBtns}
        <button class="sort-dir-btn" id="sort-dir">${S.sortDir === 'desc' ? '↓' : '↑'}</button>
        <input class="filter-input" id="search-input" type="text" placeholder="Search title…" value="${escHtml(S.search)}">
      </div>`;
  }

  // ── Render: Video Card ─────────────────────────────────────────────────────
  function renderCard(v) {
    if (v.error || !v.stats) {
      return `
        <div class="video-card has-error">
          <div class="card-top"><span class="section-badge">${escHtml(v.section)}</span></div>
          <h3 class="video-title">${escHtml(v.name)}</h3>
          <div class="card-error-msg">Data unavailable${v.error ? ' — ' + escHtml(v.error) : ''}</div>
        </div>`;
    }
    const s   = v.stats;
    const eng = s.engagement ?? 0;
    const pct = Math.max(0, Math.min(100, eng * 100));
    const flag = isFlagged(v) ? '<span class="flag-badge">⚠ Underperforming</span>' : '';
    const wUrl = `https://doorloop.wistia.com/medias/${escHtml(v.hashedId)}`;

    return `
      <div class="video-card${isFlagged(v) ? ' flagged' : ''}">
        <div class="card-top">
          <span class="section-badge">${escHtml(v.section)}</span>
          ${flag}
        </div>
        <h3 class="video-title">${escHtml(v.name)}</h3>
        <div class="metrics">
          <div class="metric-row"><span class="metric-name">Plays</span><span class="metric-val">${fmtInt(s.plays)}</span></div>
          <div class="metric-row"><span class="metric-name">Visitors</span><span class="metric-val">${fmtInt(s.visitors)}</span></div>
          <div class="metric-row"><span class="metric-name">Play Rate</span><span class="metric-val">${fmtPct(s.playRate)}</span></div>
          <div class="metric-row"><span class="metric-name">Engagement</span><span class="metric-val">${fmtPct(s.engagement)}</span></div>
          <div class="metric-row"><span class="metric-name">Page Loads</span><span class="metric-val">${fmtInt(s.pageLoads)}</span></div>
          <div class="metric-row"><span class="metric-name">Hours Watched</span><span class="metric-val">${fmtHours(s.hoursWatched)}</span></div>
        </div>
        <div class="engagement-bar"><div class="fill ${engClass(eng)}" style="width:${pct}%"></div></div>
        <a class="card-link" href="${wUrl}" target="_blank" rel="noopener">Open in Wistia ↗</a>
      </div>`;
  }

  // ── Render: Video Grid ─────────────────────────────────────────────────────
  function renderGrid(videos) {
    if (!videos.length) {
      return '<div class="state-view"><p class="state-sub">No videos match those filters.</p></div>';
    }
    return `<div class="video-grid">${videos.map(renderCard).join('')}</div>`;
  }

  // ── Render: Section Table ──────────────────────────────────────────────────
  function renderSectionTable() {
    const groups = new Map();
    S.videos.forEach(v => {
      if (!groups.has(v.section)) groups.set(v.section, []);
      groups.get(v.section).push(v);
    });

    const rows = Array.from(groups.entries()).map(([name, vids]) => {
      let plays = 0, hours = 0, engSum = 0, engN = 0;
      vids.forEach(v => {
        const s = v.stats;
        if (!s) return;
        plays += s.plays        || 0;
        hours += s.hoursWatched || 0;
        if (s.engagement != null) { engSum += s.engagement; engN++; }
      });
      return { name, count: vids.length, plays, hours, engagement: engN ? engSum / engN : null };
    });

    const dir = S.sectionSortDir === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const k = S.sectionSortBy;
      if (k === 'name') return a.name.localeCompare(b.name) * dir;
      return ((a[k] ?? -Infinity) - (b[k] ?? -Infinity)) * dir;
    });

    const headers = SECTION_COLS.map(c => {
      const active = S.sectionSortBy === c.key;
      const arrow  = active ? `<span class="sort-arrow">${S.sectionSortDir === 'desc' ? '↓' : '↑'}</span>` : '';
      return `<th data-sec-sort="${c.key}">${c.label}${arrow}</th>`;
    }).join('');

    const body = rows.map(r => `
      <tr data-section="${escHtml(r.name)}" class="${S.section === r.name ? 'row-active' : ''}">
        <td>${escHtml(r.name)}</td>
        <td>${r.count}</td>
        <td>${fmtInt(r.plays)}</td>
        <td>${fmtPct(r.engagement)}</td>
        <td>${fmtHours(r.hours)}</td>
      </tr>`).join('');

    return `
      <div class="section-block">
        <h2 class="block-heading">By Section</h2>
        <div class="data-table-wrap">
          <table class="data-table" id="section-table">
            <thead><tr>${headers}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Render: Chart Panel ────────────────────────────────────────────────────
  function renderChartPanel() {
    const chips = S.videos
      .filter(v => v.stats && v.timeline && v.timeline.length > 0)
      .sort((a, b) => (b.stats.plays || 0) - (a.stats.plays || 0))
      .map(v => {
        const sel = S.chartVideos.includes(v.hashedId);
        return `<button class="picker-chip${sel ? ' selected' : ''}" data-vid="${escHtml(v.hashedId)}">${escHtml(v.name)}</button>`;
      }).join('');

    const canvas = S.chartVideos.length
      ? '<div class="chart-canvas-wrap"><canvas id="chart-canvas"></canvas></div>'
      : '<div class="chart-empty">Select one or more videos above to see their trend.</div>';

    return `
      <div class="chart-panel">
        <h2 class="block-heading">Trend — Daily Plays</h2>
        <div class="chart-controls">
          <span class="chart-label">Date range:</span>
          <select class="chart-select" id="chart-days">
            <option value="30"${S.chartDays === 30 ? ' selected' : ''}>Last 30 days</option>
            <option value="60"${S.chartDays === 60 ? ' selected' : ''}>Last 60 days</option>
            <option value="90"${S.chartDays === 90 ? ' selected' : ''}>Last 90 days</option>
          </select>
        </div>
        <div class="video-picker" id="video-picker">${chips}</div>
        ${canvas}
      </div>`;
  }

  // ── Chart Drawing ──────────────────────────────────────────────────────────
  function buildDateRange(days) {
    const dates = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }

  function drawChart() {
    const canvas = document.getElementById('chart-canvas');
    if (!canvas) return;

    if (S.chartInstance) {
      S.chartInstance.destroy();
      S.chartInstance = null;
    }

    const dates    = buildDateRange(S.chartDays);
    const datasets = S.chartVideos.map((hashedId, idx) => {
      const video = S.videos.find(v => v.hashedId === hashedId);
      if (!video) return null;
      const tlMap = new Map((video.timeline || []).map(t => [t.date, t.plays]));
      const color = CHART_COLORS[idx % CHART_COLORS.length];
      return {
        label:           video.name,
        data:            dates.map(d => tlMap.get(d) ?? 0),
        borderColor:     color,
        backgroundColor: color + '22',
        borderWidth:     2,
        pointRadius:     2,
        pointHoverRadius: 5,
        tension:         0.3,
        fill:            false
      };
    }).filter(Boolean);

    S.chartInstance = new Chart(canvas, {
      type: 'line',
      data: { labels: dates, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#CDD5E0', font: { size: 12 }, boxWidth: 12 }
          },
          tooltip: {
            backgroundColor: '#1C2435',
            borderColor: '#2A3347',
            borderWidth: 1,
            titleColor: '#EEF2FF',
            bodyColor: '#CDD5E0'
          }
        },
        scales: {
          x: {
            ticks: { color: '#7D8BA5', maxTicksLimit: 10, font: { size: 11 } },
            grid:  { color: '#2A3347' }
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#7D8BA5', font: { size: 11 } },
            grid:  { color: '#2A3347' }
          }
        }
      }
    });
  }

  // ── Render: Full Page ──────────────────────────────────────────────────────
  function renderAll() {
    const sections = [...new Set(S.videos.map(v => v.section))].sort();

    let filtered = S.videos.slice();
    if (S.section !== 'all') filtered = filtered.filter(v => v.section === S.section);
    if (S.search) {
      const q = S.search.toLowerCase();
      filtered = filtered.filter(v => v.name.toLowerCase().includes(q));
    }
    const dir = S.sortDir === 'desc' ? -1 : 1;
    filtered.sort((a, b) => (metricVal(a, S.sortBy) - metricVal(b, S.sortBy)) * dir);

    document.getElementById('root').innerHTML =
      renderKPIs(S.videos) +
      renderFilterBar(sections) +
      renderGrid(filtered) +
      renderSectionTable() +
      renderChartPanel();

    document.getElementById('last-updated').textContent =
      S.fetchedAt ? `Last updated ${fmtTime(S.fetchedAt)}` : '';

    wireEvents();
    drawChart();
  }

  // ── Wire Events ────────────────────────────────────────────────────────────
  function wireEvents() {
    const sel = document.getElementById('section-sel');
    if (sel) sel.addEventListener('change', e => { S.section = e.target.value; renderAll(); });

    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => { S.sortBy = btn.dataset.sort; renderAll(); });
    });

    const dirBtn = document.getElementById('sort-dir');
    if (dirBtn) dirBtn.addEventListener('click', () => {
      S.sortDir = S.sortDir === 'desc' ? 'asc' : 'desc';
      renderAll();
    });

    const search = document.getElementById('search-input');
    if (search) {
      search.addEventListener('input', e => {
        S.search = e.target.value;
        renderAll();
        const s2 = document.getElementById('search-input');
        if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }
      });
    }

    const tbl = document.getElementById('section-table');
    if (tbl) {
      tbl.querySelectorAll('thead th').forEach(th => {
        th.addEventListener('click', () => {
          const k = th.dataset.secSort;
          if (S.sectionSortBy === k) {
            S.sectionSortDir = S.sectionSortDir === 'desc' ? 'asc' : 'desc';
          } else {
            S.sectionSortBy = k;
            S.sectionSortDir = 'desc';
          }
          renderAll();
        });
      });
      tbl.querySelectorAll('tbody tr').forEach(tr => {
        tr.addEventListener('click', () => {
          S.section = S.section === tr.dataset.section ? 'all' : tr.dataset.section;
          renderAll();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
    }

    const chartDaysSel = document.getElementById('chart-days');
    if (chartDaysSel) {
      chartDaysSel.addEventListener('change', e => {
        S.chartDays = parseInt(e.target.value, 10);
        renderAll();
      });
    }

    document.querySelectorAll('.picker-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.vid;
        S.chartVideos = S.chartVideos.includes(id)
          ? S.chartVideos.filter(v => v !== id)
          : [...S.chartVideos, id];
        renderAll();
      });
    });
  }

  // ── Loading / Error / Empty States ─────────────────────────────────────────
  function showLoading(msg, sub) {
    document.getElementById('root').innerHTML = `
      <div class="state-view">
        <div class="spinner"></div>
        <h3 class="state-heading">${escHtml(msg)}</h3>
        ${sub ? `<p class="state-sub">${escHtml(sub)}</p>` : ''}
      </div>`;
  }

  function showError(msg) {
    document.getElementById('root').innerHTML = `
      <div class="state-view">
        <h3 class="state-heading" style="color:var(--bad)">Something went wrong</h3>
        <p class="state-sub">${escHtml(msg)}</p>
        <button class="btn btn-primary" onclick="location.reload()">Reload page</button>
      </div>`;
  }

  function showEmpty() {
    document.getElementById('root').innerHTML = `
      <div class="state-view">
        <h3 class="state-heading">No data yet</h3>
        <p class="state-sub">Click Refresh to pull your Training Hub data from Wistia for the first time.</p>
        <button class="btn btn-primary" id="first-refresh">Refresh Now</button>
      </div>`;
    document.getElementById('first-refresh')
      ?.addEventListener('click', () => load('/api/refresh'));
  }

  // ── Data Loading ───────────────────────────────────────────────────────────
  async function load(url) {
    url = url || '/api/stats';
    const isRefresh = url.includes('refresh');
    showLoading(
      isRefresh ? 'Refreshing…' : 'Loading…',
      isRefresh ? 'Fetching latest data from Wistia for all videos.' : 'Loading cached data.'
    );
    document.getElementById('refresh-btn').disabled = true;

    try {
      const res  = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      if (!data.videos || !data.videos.length) { showEmpty(); return; }

      S.videos     = data.videos;
      S.thresholds = data.thresholds || S.thresholds;
      S.fetchedAt  = data.fetchedAt;
      renderAll();
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      document.getElementById('refresh-btn').disabled = false;
    }
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  document.getElementById('refresh-btn').addEventListener('click', () => load('/api/refresh'));
  load();
})();
```

- [ ] **Step 2: Syntax check**

```bash
node --check public/app.js
```

Expected: no output.

- [ ] **Step 3: Full visual verification**

Start server and open `http://localhost:3000`. Verify each item:

- [ ] KPI strip shows 6 metrics with real numbers
- [ ] Section filter dropdown lists all sections from the Wistia project
- [ ] All 6 sort buttons work; sort direction toggle works
- [ ] Search box filters video cards by title
- [ ] Videos with engagement < 35% show ⚠ badge and red border
- [ ] Section table is sortable by clicking column headers
- [ ] Clicking a section row in the table filters the card grid (click again to clear)
- [ ] "Open in Wistia ↗" links open correct URLs
- [ ] Selecting video chips in the chart panel renders a line chart
- [ ] Date range dropdown (30/60/90 days) updates the chart window
- [ ] Deselecting a chip removes that line
- [ ] Refresh button re-fetches and updates the Last Updated timestamp
- [ ] `cache.json` exists on disk after data loads

---

### Task 8: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: `server.js`, `lib/`, `public/`, `package.json`
- Produces: Docker image runnable with `docker run -e WISTIA_API_TOKEN=... -p 3000:3000`

- [ ] **Step 1: Write Dockerfile**

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

- [ ] **Step 2: Write .dockerignore**

```
node_modules/
.env
cache.json
.git/
.DS_Store
*.log
docs/
tests/
```

- [ ] **Step 3: Build the image**

```bash
docker build -t wistia-analytics:local .
```

Expected: build succeeds. Confirm `npm install --production` runs in the second layer (not on every code change).

- [ ] **Step 4: Run the image**

```bash
docker run -e WISTIA_API_TOKEN=your_token_here -p 3000:3000 wistia-analytics:local
```

Open `http://localhost:3000`. Expected: empty state shown (no cache.json in image). Click Refresh — data fetches from Wistia and dashboard renders. Stop with `Ctrl+C`.

---

### Task 9: Final Verification

- [ ] **Step 1: Syntax check all JS files**

```bash
node --check server.js && \
node --check lib/cache.js && \
node --check lib/wistia.js && \
node --check public/app.js && \
echo "All files pass"
```

Expected: `All files pass`

- [ ] **Step 2: Run all unit tests**

```bash
node --test tests/
```

Expected: all 10 tests pass (3 from cache.test.js, 7 from wistia.test.js).

- [ ] **Step 3: Cold-start smoke test**

```bash
rm -f cache.json
node server.js
```

Open `http://localhost:3000`:
- [ ] Empty state with "No data yet" and Refresh Now button
- [ ] Clicking Refresh Now fetches live data, shows loading spinner
- [ ] Dashboard renders with all sections populated
- [ ] `cache.json` appears on disk

- [ ] **Step 4: Cache persistence check**

Kill the server and restart:
```bash
node server.js
```

Open `http://localhost:3000`:
- [ ] Data loads immediately (from `cache.json`) — no Refresh needed
- [ ] Last Updated timestamp matches the previous fetch time
