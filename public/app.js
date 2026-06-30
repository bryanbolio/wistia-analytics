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
    chartMode:     'normal',
    chartInstance: null
  };

  const SORT_OPTIONS = [
    { key: 'plays',      label: 'Plays' },
    { key: 'visitors',   label: 'Visitors' },
    { key: 'engagement', label: 'Engagement' },
    { key: 'playRate',   label: 'Play Rate' },
    { key: 'duration',   label: 'Duration' },
    { key: 'hours',      label: 'Hours' },
    { key: 'health',     label: 'Health' }
  ];

  const SECTION_COLS = [
    { key: 'name',       label: 'Section' },
    { key: 'count',      label: 'Videos' },
    { key: 'plays',      label: 'Total Plays' },
    { key: 'engagement', label: 'Avg Engagement' },
    { key: 'avgDuration', label: 'Avg Duration' },
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
  function fmtDuration(secs) {
    if (secs == null || isNaN(secs)) return '—';
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return m + 'm ' + String(s).padStart(2, '0') + 's';
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
    if (key === 'duration') return video.duration ?? -Infinity;
    if (key === 'health')   { const h = videoHealth(video); return h ? h.total : -Infinity; }
    const st = video.stats;
    if (!st) return -Infinity;
    if (key === 'plays')      return st.plays        ?? -Infinity;
    if (key === 'visitors')   return st.visitors     ?? -Infinity;
    if (key === 'engagement') return st.engagement   ?? -Infinity;
    if (key === 'playRate')   return st.playRate      ?? -Infinity;
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

  // ── Analysis helpers ───────────────────────────────────────────────────────
  function engBenchmark(durationSecs) {
    const m = (durationSecs || 0) / 60;
    if (m < 2) return 0.70;
    if (m < 4) return 0.60;
    if (m < 7) return 0.50;
    return 0.40;
  }

  function computeTrend(timeline) {
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const d60 = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    const last30 = (timeline || []).filter(t => t.date >= d30).reduce((s, t) => s + t.plays, 0);
    const prev30 = (timeline || []).filter(t => t.date >= d60 && t.date < d30).reduce((s, t) => s + t.plays, 0);
    if (last30 === 0 && prev30 === 0) return null;
    if (prev30 === 0) return { dir: 'new', pct: null, last30 };
    const pct = (last30 - prev30) / prev30;
    return { dir: pct >= 0.10 ? 'up' : pct <= -0.10 ? 'down' : 'flat', pct, last30, prev30 };
  }

  function fmtTrend(trend) {
    if (!trend) return { text: '—', cls: '' };
    if (trend.dir === 'new')  return { text: 'New',    cls: 'trend-flat' };
    if (trend.dir === 'flat') return { text: '→ Flat', cls: 'trend-flat' };
    const p = Math.abs(Math.round(trend.pct * 100));
    if (trend.dir === 'up')   return { text: `↑ +${p}%`, cls: 'trend-up' };
    return { text: `↓ −${p}%`, cls: 'trend-down' };
  }

  function videoHealth(v) {
    if (!v.stats) return null;
    const s = v.stats;

    // Quality (40 pts): duration-adjusted engagement
    const benchmark  = engBenchmark(v.duration);
    const qualityPts = Math.min((s.engagement || 0) / benchmark, 1) * 40;

    // Discoverability (30 pts): play rate vs 30% target
    const discoverPts = Math.min((s.playRate || 0) / 0.30, 1) * 30;

    // Momentum (30 pts): 30d vs prior 30d
    const trend = computeTrend(v.timeline);
    const momentumPts = !trend || trend.dir === 'new' ? 20
      : trend.dir === 'up'   ? 30
      : trend.dir === 'flat' ? 20
      : trend.pct >= -0.30   ? 10 : 0;

    const total = Math.round(qualityPts + discoverPts + momentumPts);
    const band  = total >= 80 ? 'healthy' : total >= 60 ? 'monitor' : total >= 40 ? 'attention' : 'rebuild';
    return { total, quality: Math.round(qualityPts), discover: Math.round(discoverPts), momentum: momentumPts, band, trend };
  }

  function videoQuadrant(v) {
    if (!v.stats) return null;
    const highPlay = (v.stats.playRate  || 0) >= 0.25;
    const highEng  = (v.stats.engagement || 0) >= engBenchmark(v.duration);
    if ( highPlay &&  highEng) return 'performer';
    if ( highPlay && !highEng) return 'content';
    if (!highPlay &&  highEng) return 'placement';
    return 'rebuild';
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
        <div class="kpi"><div class="kpi-label" data-tip="Total number of times any Training Hub video has been played. Each time someone presses play counts as one play, including repeat views by the same person.">Total Plays ⓘ</div><div class="kpi-value">${fmtInt(plays)}</div></div>
        <div class="kpi"><div class="kpi-label" data-tip="Number of distinct people who visited a video page. One person watching three videos counts as three visitors (one per video page). Repeat visits by the same person to the same video are not double-counted.">Unique Visitors ⓘ</div><div class="kpi-value">${fmtInt(visitors)}</div></div>
        <div class="kpi"><div class="kpi-label" data-tip="Average percentage of each video watched across all plays, averaged across all videos. 100% means viewers watched every second; 50% means they made it halfway through on average. Health Scores use duration-adjusted benchmarks rather than this flat average.">Avg Engagement ⓘ</div><div class="kpi-value">${fmtPct(engN ? engSum / engN : null)}</div></div>
        <div class="kpi"><div class="kpi-label" data-tip="Total hours of Training Hub video content consumed. Calculated as plays × video duration × engagement rate, summed across all videos. Reflects the real educational time delivered to users.">Hours Watched ⓘ</div><div class="kpi-value">${fmtHours(hours)}</div></div>
        <div class="kpi"><div class="kpi-label" data-tip="Percentage of page visitors who clicked play, averaged across all videos. A low play rate suggests viewers aren't compelled to start — often a thumbnail, title, or placement issue. 30% is the target benchmark used in Health Scores.">Avg Play Rate ⓘ</div><div class="kpi-value">${fmtPct(rateN ? rateSum / rateN : null)}</div></div>
        <div class="kpi"><div class="kpi-label" data-tip="Number of times a page containing a Training Hub video was loaded, regardless of whether the visitor pressed play. Used alongside plays to calculate play rate.">Page Loads ⓘ</div><div class="kpi-value">${fmtInt(loads)}</div></div>
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
        <span class="filter-label">Sort:</span>
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
    const s      = v.stats;
    const eng    = s.engagement ?? 0;
    const pct    = Math.max(0, Math.min(100, eng * 100));
    const flag   = isFlagged(v) ? '<span class="flag-badge">⚠ Underperforming</span>' : '';
    const health = videoHealth(v);
    const trend  = health ? fmtTrend(health.trend) : { text: '—', cls: '' };
    const wUrl   = `https://app.wistia.com/stats/medias/${escHtml(v.hashedId)}`;

    const healthBadge = health
      ? `<span class="health-badge health-${health.band}" data-tip="Quality ${health.quality}/40 · Discover ${health.discover}/30 · Momentum ${health.momentum}/30">${health.total}</span>`
      : '';

    return `
      <div class="video-card${isFlagged(v) ? ' flagged' : ''}">
        <div class="card-top">
          <span class="section-badge">${escHtml(v.section)}</span>
          <div class="card-top-right">${flag}${healthBadge}</div>
        </div>
        <h3 class="video-title">${escHtml(v.name)}</h3>
        <div class="metrics">
          <div class="metric-row"><span class="metric-name">Plays</span><span class="metric-val">${fmtInt(s.plays)}</span></div>
          <div class="metric-row"><span class="metric-name">Visitors</span><span class="metric-val">${fmtInt(s.visitors)}</span></div>
          <div class="metric-row"><span class="metric-name">Play Rate</span><span class="metric-val">${fmtPct(s.playRate)}</span></div>
          <div class="metric-row"><span class="metric-name">Engagement</span><span class="metric-val">${fmtPct(s.engagement)}</span></div>
          <div class="metric-row"><span class="metric-name">Duration</span><span class="metric-val">${fmtDuration(v.duration)}</span></div>
          <div class="metric-row"><span class="metric-name">Hours Watched</span><span class="metric-val">${fmtHours(s.hoursWatched)}</span></div>
          <div class="metric-row"><span class="metric-name metric-tip" data-tip="Compares total plays in the last 30 days vs the prior 30 days (days 31–60). ↑ Up = +10% or more · → Flat = within ±10% · ↓ Down = −10% or more. No data in either window = —">30d Trend ⓘ</span><span class="metric-val ${trend.cls}">${trend.text}</span></div>
          <div class="metric-row"><span class="metric-name">Published</span><span class="metric-val">${fmtDate(v.createdAt)}</span></div>
        </div>
        <div class="engagement-bar"><div class="fill ${engClass(eng)}" style="--bar-w:${pct}%"></div></div>
        <a class="card-link" href="${wUrl}" target="_blank" rel="noopener">View Analytics &amp; Heatmap ↗</a>
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
      let plays = 0, hours = 0, engSum = 0, engN = 0, durSum = 0, durN = 0;
      vids.forEach(v => {
        if (v.duration != null) { durSum += v.duration; durN++; }
        const s = v.stats;
        if (!s) return;
        plays += s.plays        || 0;
        hours += s.hoursWatched || 0;
        if (s.engagement != null) { engSum += s.engagement; engN++; }
      });
      return { name, count: vids.length, plays, hours, engagement: engN ? engSum / engN : null, avgDuration: durN ? durSum / durN : null };
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
        <td>${fmtDuration(r.avgDuration)}</td>
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

    const isCompare = S.chartMode === 'compare';

    const dateRangeCtrl = isCompare
      ? '<span class="compare-period-label">Last 30d vs Prior 30d</span>'
      : `<span class="chart-label">Date range:</span>
         <select class="chart-select" id="chart-days">
           <option value="30"${S.chartDays === 30 ? ' selected' : ''}>Last 30 days</option>
           <option value="60"${S.chartDays === 60 ? ' selected' : ''}>Last 60 days</option>
           <option value="90"${S.chartDays === 90 ? ' selected' : ''}>Last 90 days</option>
         </select>`;

    const emptyMsg = isCompare
      ? 'Select one or more videos above to compare last 30 days vs prior 30 days.'
      : 'Select one or more videos above to see their trend.';

    const canvas = S.chartVideos.length
      ? '<div class="chart-canvas-wrap"><canvas id="chart-canvas"></canvas></div>'
      : `<div class="chart-empty">${emptyMsg}</div>`;

    return `
      <div class="chart-panel">
        <h2 class="block-heading">${isCompare ? 'Period Comparison — Last 30d vs Prior 30d' : 'Trend — Daily Plays'}</h2>
        <div class="chart-controls">
          ${dateRangeCtrl}
          <button class="chart-mode-btn${isCompare ? ' active' : ''}" id="chart-compare">Compare Periods</button>
        </div>
        <div class="video-picker" id="video-picker">${chips}</div>
        ${canvas}
      </div>`;
  }

  // ── Chart Drawing ──────────────────────────────────────────────────────────
  const CHART_OPTS_BASE = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#CDD5E0', font: { size: 12 }, boxWidth: 12 } },
      tooltip: {
        backgroundColor: '#1C2435', borderColor: '#2A3347', borderWidth: 1,
        titleColor: '#EEF2FF', bodyColor: '#CDD5E0'
      }
    },
    scales: {
      x: { ticks: { color: '#7D8BA5', maxTicksLimit: 10, font: { size: 11 } }, grid: { color: '#2A3347' } },
      y: { beginAtZero: true, ticks: { color: '#7D8BA5', font: { size: 11 } }, grid: { color: '#2A3347' } }
    }
  };

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
    if (S.chartInstance) { S.chartInstance.destroy(); S.chartInstance = null; }
    if (S.chartMode === 'compare') { drawCompareChart(canvas); } else { drawNormalChart(canvas); }
  }

  function drawNormalChart(canvas) {
    const dates    = buildDateRange(S.chartDays);
    const datasets = S.chartVideos.map((hashedId, idx) => {
      const video = S.videos.find(v => v.hashedId === hashedId);
      if (!video) return null;
      const tlMap = new Map((video.timeline || []).map(t => [t.date, t.plays]));
      const color = CHART_COLORS[idx % CHART_COLORS.length];
      return {
        label: video.name,
        data:  dates.map(d => tlMap.get(d) ?? 0),
        borderColor: color, backgroundColor: color + '22',
        borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, tension: 0.3, fill: false
      };
    }).filter(Boolean);

    S.chartInstance = new Chart(canvas, {
      type: 'line',
      data: { labels: dates, datasets },
      options: CHART_OPTS_BASE
    });
  }

  function drawCompareChart(canvas) {
    const last30Dates = buildDateRange(30);
    const prev30Dates = buildDateRange(60).slice(0, 30);
    const dayLabels   = Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`);

    const datasets = [];
    S.chartVideos.forEach((hashedId, idx) => {
      const video = S.videos.find(v => v.hashedId === hashedId);
      if (!video) return;
      const tlMap = new Map((video.timeline || []).map(t => [t.date, t.plays]));
      const color = CHART_COLORS[idx % CHART_COLORS.length];

      datasets.push({
        label: video.name + ' — Last 30d',
        data:  last30Dates.map(d => tlMap.get(d) ?? 0),
        borderColor: color, backgroundColor: color + '22',
        borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, tension: 0.3, fill: false
      });
      datasets.push({
        label: video.name + ' — Prior 30d',
        data:  prev30Dates.map(d => tlMap.get(d) ?? 0),
        borderColor: color, backgroundColor: 'transparent',
        borderDash: [5, 4],
        borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, tension: 0.3, fill: false
      });
    });

    const opts = Object.assign({}, CHART_OPTS_BASE, {
      plugins: Object.assign({}, CHART_OPTS_BASE.plugins, {
        tooltip: Object.assign({}, CHART_OPTS_BASE.plugins.tooltip, {
          callbacks: {
            title(items) {
              const i = items[0]?.dataIndex ?? 0;
              return `Last 30d: ${last30Dates[i]}  ·  Prior 30d: ${prev30Dates[i]}`;
            }
          }
        })
      })
    });

    S.chartInstance = new Chart(canvas, {
      type: 'line',
      data: { labels: dayLabels, datasets },
      options: opts
    });
  }

  // ── Render: Quadrant Panel ─────────────────────────────────────────────────
  function renderQuadrantPanel(videos) {
    const scored = videos.filter(v => v.stats);
    const buckets = { performer: [], placement: [], content: [], rebuild: [] };
    scored.forEach(v => {
      const q = videoQuadrant(v);
      if (q) buckets[q].push(v);
    });

    function quadrantList(vids) {
      if (!vids.length) return '<p class="quad-empty">None</p>';
      return vids.map(v => `<div class="quad-item">${escHtml(v.name)}</div>`).join('');
    }

    return `
      <div class="quadrant-panel">
        <h2 class="block-heading">Quadrant Analysis</h2>
        <p class="quadrant-desc">Play rate ≥25% = high reach · Engagement ≥ duration benchmark = high quality</p>
        <div class="quadrant-grid">
          <div class="quad-cell quad-performer">
            <div class="quad-header">
              <span class="quad-title">High Performers</span>
              <span class="quad-count">${buckets.performer.length}</span>
            </div>
            <div class="quad-meta">High reach · High quality</div>
            <div class="quad-list">${quadrantList(buckets.performer)}</div>
          </div>
          <div class="quad-cell quad-placement">
            <div class="quad-header">
              <span class="quad-title">Placement Problem</span>
              <span class="quad-count">${buckets.placement.length}</span>
            </div>
            <div class="quad-meta">Low reach · High quality — needs better surfacing</div>
            <div class="quad-list">${quadrantList(buckets.placement)}</div>
          </div>
          <div class="quad-cell quad-content">
            <div class="quad-header">
              <span class="quad-title">Content Problem</span>
              <span class="quad-count">${buckets.content.length}</span>
            </div>
            <div class="quad-meta">High reach · Low quality — content needs work</div>
            <div class="quad-list">${quadrantList(buckets.content)}</div>
          </div>
          <div class="quad-cell quad-rebuild">
            <div class="quad-header">
              <span class="quad-title">Rebuild Needed</span>
              <span class="quad-count">${buckets.rebuild.length}</span>
            </div>
            <div class="quad-meta">Low reach · Low quality — full rethink</div>
            <div class="quad-list">${quadrantList(buckets.rebuild)}</div>
          </div>
        </div>
      </div>`;
  }

  // ── Render: Methodology Panel ──────────────────────────────────────────────
  function renderMethodologyPanel() {
    return `
      <details class="methodology-panel">
        <summary>How scores are calculated</summary>
        <div class="methodology-body">

          <div class="methodology-section">
            <h3 class="methodology-heading">Health Score (0–100)</h3>
            <p class="methodology-intro">Three dimensions — quality, reach, and momentum — combined into a single number so you can sort and prioritize at a glance.</p>

            <div class="methodology-dim">
              <div class="methodology-dim-header">
                <span class="methodology-dim-name">Content Quality</span>
                <span class="methodology-dim-pts">40 pts max</span>
              </div>
              <p>How well does the video hold attention relative to its length? Formula: <code>(engagement ÷ duration benchmark) × 40</code>, capped at 40.</p>
              <p>Duration benchmarks used: under 2 min → 70% expected · 2–4 min → 60% · 4–7 min → 50% · 7+ min → 40%. A flat engagement threshold would penalize longer content — a 7-minute accounting deep-dive at 48% engagement is doing well, while a 90-second overview at 55% is not. Duration-adjusting makes the comparison fair.</p>
            </div>

            <div class="methodology-dim">
              <div class="methodology-dim-header">
                <span class="methodology-dim-name">Discoverability</span>
                <span class="methodology-dim-pts">30 pts max</span>
              </div>
              <p>Are people watching when they encounter it? Formula: <code>(play rate ÷ 30%) × 30</code>, capped at 30.</p>
              <p>30% play rate is a strong industry benchmark for embedded educational video. Below it, a meaningful portion of visitors are skipping the video entirely — a signal that placement, thumbnail, or the title isn't pulling people in.</p>
            </div>

            <div class="methodology-dim">
              <div class="methodology-dim-header">
                <span class="methodology-dim-name">Momentum</span>
                <span class="methodology-dim-pts">30 pts max</span>
              </div>
              <p>Is interest growing, holding, or fading? Compares total plays in the last 30 days vs the prior 30 days.</p>
              <p>Up (+10% or more) = 30 pts · Flat (±10%) = 20 pts · Moderate decline (to −30%) = 10 pts · Severe decline (over −30%) = 0 pts. A video can have strong absolute numbers but still need attention if it's in consistent decline.</p>
            </div>

            <table class="methodology-table">
              <thead><tr><th>Score</th><th>Band</th><th>Action</th></tr></thead>
              <tbody>
                <tr><td>80–100</td><td><span class="health-badge health-healthy">Healthy</span></td><td>Performing well across all three dimensions. Monitor occasionally.</td></tr>
                <tr><td>60–79</td><td><span class="health-badge health-monitor">Monitor</span></td><td>One dimension is weak. Track trend over the next refresh cycle.</td></tr>
                <tr><td>40–59</td><td><span class="health-badge health-attention">Attention</span></td><td>At least two dimensions are underperforming. Review and plan a fix.</td></tr>
                <tr><td>0–39</td><td><span class="health-badge health-rebuild">Rebuild</span></td><td>Failing on most fronts. Prioritize for rework or removal.</td></tr>
              </tbody>
            </table>
          </div>

          <div class="methodology-section">
            <h3 class="methodology-heading">Quadrant Analysis</h3>
            <p class="methodology-intro">Every video is placed into one of four quadrants based on two questions: are people watching when they see it, and when they watch, do they stick around?</p>

            <div class="methodology-dim">
              <div class="methodology-dim-header"><span class="methodology-dim-name">Axes</span></div>
              <p><strong>Play Rate (threshold: 25%)</strong> — Are people hitting play when they land on the page? Below 25%, a significant share of visitors are skipping. This measures reach and first impression.</p>
              <p><strong>Engagement vs. duration benchmark</strong> — Same duration-adjusted benchmarks as the Health Score. This measures whether the content is worth finishing once someone starts.</p>
            </div>

            <table class="methodology-table">
              <thead><tr><th>Quadrant</th><th>Signal</th><th>What to do</th></tr></thead>
              <tbody>
                <tr><td><strong>High Performers</strong></td><td>High reach + high quality</td><td>Leave these alone. Study what makes them work and apply it elsewhere.</td></tr>
                <tr><td><strong>Placement Problem</strong></td><td>Low reach + high quality</td><td>Content is good — it's just not being surfaced. Try better thumbnails, placement in the Training Hub, or a mention in onboarding.</td></tr>
                <tr><td><strong>Content Problem</strong></td><td>High reach + low quality</td><td>People click but don't finish. Review pacing, length, structure, or audio quality. The concept is interesting — the execution isn't landing.</td></tr>
                <tr><td><strong>Rebuild Needed</strong></td><td>Low reach + low quality</td><td>Neither found nor engaging. Full rework or removal. Start with the ones in the Rebuild band of the Health Score.</td></tr>
              </tbody>
            </table>
          </div>

        </div>
      </details>`;
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
      renderQuadrantPanel(S.videos) +
      renderChartPanel() +
      renderMethodologyPanel();

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

    const compareBtn = document.getElementById('chart-compare');
    if (compareBtn) {
      compareBtn.addEventListener('click', () => {
        S.chartMode = S.chartMode === 'compare' ? 'normal' : 'compare';
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
        <h3 class="state-heading error-heading">Something went wrong</h3>
        <p class="state-sub">${escHtml(msg)}</p>
        <button class="btn btn-primary" id="reload-btn">Reload page</button>
      </div>`;
    const reloadBtn = document.getElementById('reload-btn');
    if (reloadBtn) reloadBtn.addEventListener('click', () => location.reload());
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

  // ── Click Tooltip ──────────────────────────────────────────────────────────
  function initTooltip() {
    const popup = document.createElement('div');
    popup.className = 'tip-popup';
    popup.hidden = true;
    document.body.appendChild(popup);

    let activeEl = null;

    document.addEventListener('click', e => {
      const trigger = e.target.closest('[data-tip]');
      if (trigger) {
        if (activeEl === trigger) {
          popup.hidden = true;
          activeEl = null;
          return;
        }
        activeEl = trigger;
        popup.textContent = trigger.dataset.tip;
        popup.hidden = false;

        const r  = trigger.getBoundingClientRect();
        const pw = popup.offsetWidth;
        const ph = popup.offsetHeight;
        let left = r.left;
        let top  = r.bottom + 8;

        if (left + pw > window.innerWidth  - 12) left = Math.max(8, window.innerWidth  - pw - 12);
        if (top  + ph > window.innerHeight - 12) top  = r.top - ph - 8;

        popup.style.left = left + 'px';
        popup.style.top  = top  + 'px';
      } else {
        popup.hidden = true;
        activeEl = null;
      }
    });
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  initTooltip();
  document.getElementById('refresh-btn').addEventListener('click', () => load('/api/refresh'));
  load();
})();
