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

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  document.getElementById('refresh-btn').addEventListener('click', () => load('/api/refresh'));
  load();
})();
