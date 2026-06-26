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
    // No cache exists — return empty state; live fetch only on /api/refresh
    return { videos: null };
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
