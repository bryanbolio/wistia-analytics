const PROJECT_ID = 'stce6aea96';
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 150;
const TIMELINE_DAYS = 90;
const EVENTS_PER_VIDEO = 100;
const TOP_PAGES = 5;

function num(a, b) {
  const va = parseFloat(a);
  if (!isNaN(va)) return va;
  const vb = parseFloat(b);
  return !isNaN(vb) ? vb : 0;
}

function decodeHtml(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function topEmbedPages(events, limit) {
  const counts = {};
  (events || []).forEach(e => {
    if (e.embed_url) counts[e.embed_url] = (counts[e.embed_url] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([url, count]) => ({ url, count }));
}

function buildVideoObject(media, stats, timeline, error = null, embedPages = []) {
  // Handle nested stats.stats shape
  const s = stats && stats.stats ? stats.stats : stats;

  // Wistia stats API uses snake_case; fall back to camelCase for test fixtures
  const plays     = num(s && s.play_count,   s && s.plays);
  const pageLoads = num(s && s.load_count,   s && s.pageLoads);
  const playRate  = num(s && s.play_rate,    s && s.percentOfVisitorsClickingPlay);
  const engagement = s ? (s.engagement || s.averagePercentWatched || 0) : 0;
  // Prefer API-provided hours_watched; fall back to derived value
  const hoursWatched = s
    ? (num(s.hours_watched, 0) || (plays * (media.duration || 0) * engagement) / 3600)
    : 0;

  return {
    hashedId:  media.hashed_id,
    name:      decodeHtml(media.name),
    section:   decodeHtml(media.section) || 'Unsectioned',
    duration:  media.duration,
    thumbnail: media.thumbnail ? media.thumbnail.url : null,
    createdAt: media.created,
    stats: s ? { plays, visitors: s.visitors || 0, playRate, engagement, pageLoads, hoursWatched } : null,
    timeline: timeline
      ? timeline.map(t => ({ date: t.date, plays: num(t.play_count, t.plays) }))
      : [],
    embedPages: embedPages || [],
    error: error || null,
  };
}

async function fetchAll(token, timelineDays = TIMELINE_DAYS) {
  const headers = { Authorization: `Bearer ${token}` };
  const BASE = 'https://api.wistia.com/v1';

  const mediasRes = await fetch(`${BASE}/medias.json?project_id=${PROJECT_ID}&per_page=500`, { headers });
  if (!mediasRes.ok) throw new Error(`Medias fetch failed: ${mediasRes.status}`);
  const allMedias = await mediasRes.json();

  const medias = allMedias.filter(m => m.type === 'Video');
  const videos = [];

  for (let i = 0; i < medias.length; i += BATCH_SIZE) {
    const batch = medias.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(batch.map(async (media) => {
      try {
        const [statsRes, timelineRes, eventsRes] = await Promise.all([
          fetch(`${BASE}/stats/medias/${media.hashed_id}.json`, { headers }),
          fetch(`${BASE}/stats/medias/${media.hashed_id}/by_date.json?start_date=${daysAgo(timelineDays)}&end_date=${daysAgo(0)}`, { headers }),
          fetch(`${BASE}/stats/events.json?media_id=${media.hashed_id}&per_page=${EVENTS_PER_VIDEO}`, { headers }),
        ]);

        const stats    = statsRes.ok    ? await statsRes.json()    : null;
        const timeline = timelineRes.ok ? await timelineRes.json() : [];
        const events   = eventsRes.ok   ? await eventsRes.json()   : [];
        const statsError    = statsRes.ok    ? null : `Stats fetch failed: ${statsRes.status}`;
        const timelineError = timelineRes.ok ? null : `Timeline fetch failed: ${timelineRes.status}`;
        const embedPages = topEmbedPages(events, TOP_PAGES);

        return buildVideoObject(media, stats, timeline, statsError || timelineError, embedPages);
      } catch (err) {
        return buildVideoObject(media, null, null, err.message);
      }
    }));

    videos.push(...batchResults);

    if (i + BATCH_SIZE < medias.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  return videos;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

module.exports = { fetchAll, buildVideoObject };
