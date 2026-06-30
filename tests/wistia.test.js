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
  assert.strictEqual(result.section, 'Foundations & Navigation');
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
  const mediaNoSection = { ...sampleMedia, name: 'Unknown Video', section: null };
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
