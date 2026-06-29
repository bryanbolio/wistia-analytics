const PROJECT_ID = 'stce6aea96';
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 150;
const TIMELINE_DAYS = 90;

// Helper: safely parse numeric fields that may be plays or play_count
function num(a, b) {
  const va = parseFloat(a);
  if (!isNaN(va)) return va;
  const vb = parseFloat(b);
  return !isNaN(vb) ? vb : 0;
}

// Build a normalized video object from Wistia API responses
function buildVideoObject(media, stats, timeline, error = null) {
  // Handle nested stats.stats shape
  const s = stats && stats.stats ? stats.stats : stats;

  const normalized = {
    hashedId: media.hashed_id,
    name: media.name,
    section: media.section || 'Unsectioned',
    duration: media.duration,
    thumbnail: media.thumbnail ? media.thumbnail.url : null,
    createdAt: media.created,
    stats: s ? {
      plays: s.plays || 0,
      visitors: s.visitors || 0,
      playRate: s.percentOfVisitorsClickingPlay || 0,
      engagement: s.averagePercentWatched || 0,
      pageLoads: s.pageLoads || 0,
      hoursWatched: ((s.plays || 0) * (media.duration || 0) * (s.averagePercentWatched || 0)) / 3600
    } : null,
    timeline: timeline ? timeline.map(t => ({ date: t.date, plays: num(t.plays, t.play_count) })) : [],
    error: error || null
  };
  return normalized;
}

// Fetch all videos from the Wistia project with stats and timelines
async function fetchAll(token, timelineDays = TIMELINE_DAYS) {
  const headers = { Authorization: `Bearer ${token}` };
  const BASE = 'https://api.wistia.com/v1';

  // 1. Fetch all medias in project
  const mediasRes = await fetch(`${BASE}/medias.json?project_id=${PROJECT_ID}&per_page=500`, { headers });
  if (!mediasRes.ok) throw new Error(`Medias fetch failed: ${mediasRes.status}`);
  const allMedias = await mediasRes.json();

  // Filter to videos only
  const medias = allMedias.filter(m => m.type === 'Video');

  const videos = [];

  // Process in batches
  for (let i = 0; i < medias.length; i += BATCH_SIZE) {
    const batch = medias.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(batch.map(async (media) => {
      try {
        const [statsRes, timelineRes] = await Promise.all([
          fetch(`${BASE}/stats/medias/${media.hashed_id}.json`, { headers }),
          fetch(`${BASE}/medias/${media.hashed_id}/timeline.json?start_date=${daysAgo(timelineDays)}&end_date=${daysAgo(0)}`, { headers })
        ]);

        const stats = statsRes.ok ? await statsRes.json() : null;
        const timeline = timelineRes.ok ? await timelineRes.json() : [];
        const statsError = statsRes.ok ? null : `Stats fetch failed: ${statsRes.status}`;
        const timelineError = timelineRes.ok ? null : `Timeline fetch failed: ${timelineRes.status}`;

        return buildVideoObject(media, stats, timeline, statsError || timelineError);
      } catch (err) {
        return buildVideoObject(media, null, null, err.message);
      }
    }));

    videos.push(...batchResults);

    // Delay between batches (not after the last batch)
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
