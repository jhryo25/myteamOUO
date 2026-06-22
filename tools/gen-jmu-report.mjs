#!/usr/bin/env node
/**
 * 生成佳木斯机票价格 HTML 报告
 * 输入：reports/clean_data.json（clean-jmu-prices.mjs 输出）
 * 输出：reports/jiamusi_flight_report_<YYYYMMDD>.html
 *
 * 设计要点：
 *   - 单文件，内嵌 CSS / JS / Canvas 图表，无需外部依赖。
 *   - 响应式布局，桌面与移动端均可浏览。
 *   - 包含：摘要卡片、每日最低价趋势图、航线汇总表、每日航线明细表。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORTS_DIR = join(ROOT, 'reports');

export function loadCleanData(inputPath = join(REPORTS_DIR, 'clean_data.json')) {
  if (!existsSync(inputPath)) {
    throw new Error(`找不到清洗数据文件：${inputPath}`);
  }
  return JSON.parse(readFileSync(inputPath, 'utf8'));
}

export function escapeHtml(raw) {
  if (raw == null) return '';
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtPrice(n) {
  return n == null ? '—' : `¥${Number(n).toLocaleString('zh-CN')}`;
}

function fmtRate(n) {
  return n == null ? '—' : `${(n * 100).toFixed(0)}%`;
}

function fmtInt(n) {
  return n == null ? '—' : Number(n).toLocaleString('zh-CN');
}

function fmtDateShort(iso) {
  return iso ? iso.slice(5).replace('-', '/') : '';
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function dailyChartData(data) {
  return (data.dailySummary || [])
    .map((d) => ({
      date: d.date,
      label: fmtDateShort(d.date),
      dailyLowestPrice: d.dailyLowestPrice,
      dailyAvgPrice: d.dailyAvgPrice,
    }))
    .filter((d) => d.dailyLowestPrice != null);
}

/**
 * 计算“最佳价格组合”：在每一天的所有航线中选取最低价航班，
 * 汇总为连续 N 天总成本最低的方案。
 */
export function computeBestCombo(data) {
  const prices = data.prices || [];
  const byDate = new Map();

  for (const row of prices) {
    if (!row.hasFlight || row.lowestPrice == null) continue;
    const existing = byDate.get(row.date);
    if (!existing || row.lowestPrice < existing.lowestPrice) {
      byDate.set(row.date, row);
    }
  }

  const items = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const totalPrice = items.reduce((sum, r) => sum + r.lowestPrice, 0);
  const missingDates = (data.dailySummary || [])
    .filter((d) => d.dailyLowestPrice == null)
    .map((d) => d.date);

  return {
    strategy: '每天选取所有航线中的最低价航班求和',
    totalPrice,
    currency: 'CNY',
    daysWithPrice: items.length,
    daysMissing: missingDates.length,
    missingDates,
    items: items.map((r) => ({
      date: r.date,
      routeId: r.routeId,
      origin: r.origin,
      originCode: r.originCode,
      destination: r.destination,
      destinationCode: r.destinationCode,
      lowestPrice: r.lowestPrice,
      avgPrice: r.avgPrice,
      cheapestAirlines: r.cheapestAirlines || [],
      cheapestAirlineText: r.cheapestAirlineText || (r.cheapestAirlines || []).join(' / ') || '—',
      flightCount: r.flightCount,
      discountRate: r.discountRate,
      sourceUrl: r.sourceUrl,
    })),
  };
}

function routeSummaryRows(routeSummary) {
  return (routeSummary || [])
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.origin)}<br><small class="muted">${escapeHtml(r.originCode)}-${escapeHtml(r.destinationCode)}</small></td>
      <td>${fmtPrice(r.minLowestPrice)}</td>
      <td>${fmtPrice(r.avgLowestPrice)}</td>
      <td>${fmtPrice(r.maxLowestPrice)}</td>
      <td>${fmtPrice(r.avgFlightPrice)}</td>
      <td>${fmtRate(r.avgDiscountRate)}</td>
      <td>${fmtInt(r.datesWithPrice)}</td>
    </tr>
  `
    )
    .join('');
}

export function buildHtml(data) {
  const meta = data.meta || {};
  const overall = data.overallSummary || {};
  const routeSummary = data.routeSummary || [];
  const dateRangeText = meta.dateRangeStart && meta.dateRangeEnd
    ? `${meta.dateRangeStart} ~ ${meta.dateRangeEnd}`
    : '—';
  const generatedAtText = fmtDateTime(meta.generatedAt);
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');

  const summaryCards = [
    { label: '航线数', value: fmtInt(routeSummary.length) },
    { label: '覆盖天数', value: fmtInt((data.dailySummary || []).length) },
    { label: '有报价组合', value: `${fmtInt(overall.combosWithPrice)} / ${fmtInt(overall.totalRouteDateCombos)}` },
    { label: '缺失组合', value: fmtInt(overall.missingCombos) },
    { label: '全局最低价', value: fmtPrice(overall.globalLowestPrice), highlight: true },
    { label: '平均最低价', value: fmtPrice(overall.globalAvgLowestPrice) },
  ];

  const cardsHtml = summaryCards
    .map(
      (c) => `
    <div class="card">
      <h3>${escapeHtml(c.label)}</h3>
      <div class="value ${c.highlight ? 'highlight' : ''}">${c.value}</div>
    </div>
  `
    )
    .join('');

  const routeRows = routeSummaryRows(routeSummary);

  const bestCombo = computeBestCombo(data);
  const bestComboRows = bestCombo.items
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.origin)}<br><small class="muted">${escapeHtml(r.originCode)}-${escapeHtml(r.destinationCode)}</small></td>
      <td>${fmtPrice(r.lowestPrice)}</td>
      <td>${fmtPrice(r.avgPrice)}</td>
      <td>${escapeHtml(r.cheapestAirlineText)}</td>
      <td>${fmtInt(r.flightCount)}</td>
      <td>${fmtRate(r.discountRate)}</td>
      <td>${r.sourceUrl ? `<a href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener">携程</a>` : '—'}</td>
    </tr>
  `
    )
    .join('');

  const bestComboSummary = [
    { label: '组合策略', value: escapeHtml(bestCombo.strategy) },
    { label: '覆盖天数', value: `${fmtInt(bestCombo.daysWithPrice)} / ${fmtInt((data.dailySummary || []).length)}` },
    { label: '缺失天数', value: fmtInt(bestCombo.daysMissing) },
    { label: '7 天总价格', value: fmtPrice(bestCombo.totalPrice), highlight: true },
  ];

  const bestComboCardsHtml = bestComboSummary
    .map(
      (c) => `
    <div class="card">
      <h3>${escapeHtml(c.label)}</h3>
      <div class="value ${c.highlight ? 'highlight' : ''}">${c.value}</div>
    </div>
  `
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>佳木斯机票价格报告 · ${escapeHtml(meta.dateRangeStart || '')}</title>
  <style>
    :root {
      --bg: #f7f8fa;
      --card: #ffffff;
      --text: #1f2937;
      --muted: #6b7280;
      --border: #e5e7eb;
      --accent: #0d9488;
      --accent-light: #ccfbf1;
      --low: #2563eb;
      --avg: #10b981;
      --highlight: #ea580c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }
    header {
      background: linear-gradient(135deg, #0f766e, #14b8a6);
      color: #fff;
      padding: 2rem 1rem;
      text-align: center;
    }
    header h1 { margin: 0; font-size: 1.75rem; }
    header p { margin: 0.5rem 0 0; opacity: 0.9; font-size: 0.95rem; }
    main { max-width: 1200px; margin: 0 auto; padding: 1.5rem 1rem; }
    section { margin-bottom: 2rem; }
    h2 {
      font-size: 1.25rem;
      margin-bottom: 0.75rem;
      border-left: 4px solid var(--accent);
      padding-left: 0.6rem;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem;
    }
    .card {
      background: var(--card);
      border-radius: 0.75rem;
      padding: 1rem;
      border: 1px solid var(--border);
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .card h3 {
      margin: 0 0 0.25rem;
      font-size: 0.85rem;
      color: var(--muted);
      font-weight: 500;
    }
    .card .value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text);
    }
    .card .value.highlight { color: var(--highlight); }
    .table-scroll {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      background: var(--card);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th, td {
      padding: 0.65rem 0.6rem;
      text-align: right;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    th {
      background: #f3f4f6;
      color: var(--muted);
      font-weight: 600;
      font-size: 0.8rem;
    }
    td:first-child, th:first-child { text-align: left; }
    tbody tr:hover { background: #f9fafb; }
    tbody tr:last-child td { border-bottom: none; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .muted { color: var(--muted); }
    .no-flight { color: var(--muted); font-style: italic; text-align: center; }
    .chart-wrap {
      position: relative;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1rem;
    }
    canvas {
      display: block;
      width: 100%;
      height: auto;
      aspect-ratio: 900 / 360;
    }
    .tooltip {
      position: absolute;
      display: none;
      background: rgba(0,0,0,0.85);
      color: #fff;
      padding: 0.5rem 0.75rem;
      border-radius: 0.4rem;
      font-size: 0.8rem;
      pointer-events: none;
      white-space: nowrap;
      z-index: 10;
    }
    .legend {
      margin-top: 0.75rem;
      color: var(--muted);
      font-size: 0.85rem;
      text-align: center;
    }
    .legend .dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin: 0 0.25rem 0 0.75rem;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .filters label { font-size: 0.85rem; color: var(--muted); }
    .filters select,
    .filters input,
    .filters button {
      padding: 0.35rem 0.5rem;
      border: 1px solid var(--border);
      border-radius: 0.35rem;
      font-size: 0.85rem;
      background: var(--card);
    }
    .filters button {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
      cursor: pointer;
    }
    .filters button:hover { background: #0f766e; }
    .note-list {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1rem 1.5rem;
      font-size: 0.9rem;
      color: var(--muted);
    }
    .note-list li { margin-bottom: 0.35rem; }
    footer {
      text-align: center;
      padding: 2rem 1rem;
      color: var(--muted);
      font-size: 0.85rem;
    }
    @media (max-width: 640px) {
      header h1 { font-size: 1.4rem; }
      .cards { grid-template-columns: repeat(2, 1fr); }
      th, td { padding: 0.5rem 0.35rem; font-size: 0.8rem; }
    }
  </style>
</head>
<body>
  <header>
    <h1>佳木斯机票价格报告</h1>
    <p>数据源：${escapeHtml(meta.sourceReport || '携程移动版 H5')} | 目的地：${escapeHtml(meta.destination || '佳木斯')} (${escapeHtml(meta.destinationCode || 'JMU')}) | 日期范围：${escapeHtml(dateRangeText)}</p>
    <p>生成时间：${escapeHtml(generatedAtText)}</p>
  </header>

  <main>
    <section>
      <h2>数据概览</h2>
      <div class="cards">${cardsHtml}</div>
    </section>

    <section>
      <h2>最佳价格组合</h2>
      <div class="cards">${bestComboCardsHtml}</div>
      <div class="table-scroll" style="margin-top:1rem">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>航线</th>
              <th>最低价</th>
              <th>当日均价</th>
              <th>最便宜航司</th>
              <th>航班数</th>
              <th>折扣</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>${bestComboRows || '<tr><td colspan="8" class="no-flight">暂无足够数据生成最佳组合</td></tr>'}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>每日最低价趋势</h2>
      <div class="chart-wrap">
        <canvas id="priceChart" width="900" height="360"></canvas>
        <div id="tooltip" class="tooltip"></div>
      </div>
      <div class="legend">
        <span class="dot" style="background:var(--low)"></span>当日所有航线最低价
        <span class="dot" style="background:var(--avg)"></span>当日航线最低价均价
      </div>
    </section>

    <section>
      <h2>航线汇总（近15天）</h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>航线</th>
              <th>最低最低价</th>
              <th>平均最低价</th>
              <th>最高最低价</th>
              <th>平均全价</th>
              <th>平均折扣</th>
              <th>有报价天数</th>
            </tr>
          </thead>
          <tbody>${routeRows}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>每日航线明细</h2>
      <div class="filters">
        <label>出发城市
          <select id="originFilter"><option value="">全部</option></select>
        </label>
        <label>日期
          <select id="dateFilter"><option value="">全部</option></select>
        </label>
        <label><input type="checkbox" id="flightFilter" checked> 仅显示有航班</label>
        <button id="resetFilters">重置</button>
      </div>
      <div class="table-scroll">
        <table id="detailTable">
          <thead>
            <tr>
              <th>日期</th>
              <th>出发城市</th>
              <th>航线</th>
              <th>最低价</th>
              <th>平均价</th>
              <th>最便宜航司</th>
              <th>航班数</th>
              <th>折扣</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>数据说明</h2>
      <ul class="note-list">
        <li>数据抓取自携程移动版 H5，覆盖 ${escapeHtml(dateRangeText)} 共 ${fmtInt((data.dailySummary || []).length)} 天。</li>
        <li>“最低价”指当日该航线所有航班中的最低报价（CNY，四舍五入到元）。</li>
        <li>缺失价格/航班为空的组合已标注为“无航班”，不参与均价与折扣统计，且不进行补全。</li>
        <li>航司名已统一为官方简称；海航系已拆分为实际承运航司。</li>
        <li>本报告由 myteam 自动生成，仅供内部参考。</li>
      </ul>
    </section>
  </main>

  <footer>
    本报告由 myteam 自动生成，仅供内部参考，不构成购票或投资建议。
  </footer>

  <script>
    const REPORT_DATA = ${dataJson};

    function fmtPrice(n) { return n == null ? '—' : '¥' + Number(n).toLocaleString('zh-CN'); }
    function fmtRate(n) { return n == null ? '—' : (n * 100).toFixed(0) + '%'; }
    function fmtInt(n) { return n == null ? '—' : Number(n).toLocaleString('zh-CN'); }
    function escapeHtml(raw) {
      if (raw == null) return '';
      return String(raw)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ---------- 明细表渲染与筛选 ----------
    const originFilter = document.getElementById('originFilter');
    const dateFilter = document.getElementById('dateFilter');
    const flightFilter = document.getElementById('flightFilter');
    const resetFilters = document.getElementById('resetFilters');
    const detailTbody = document.querySelector('#detailTable tbody');

    const origins = [...new Set(REPORT_DATA.prices.map(function(r){ return r.originCode; }))].sort();
    const originNames = {};
    REPORT_DATA.prices.forEach(function(r){ originNames[r.originCode] = r.origin; });
    origins.forEach(function(code){
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = escapeHtml(originNames[code] + ' (' + code + ')');
      originFilter.appendChild(opt);
    });

    const dates = [...new Set(REPORT_DATA.prices.map(function(r){ return r.date; }))].sort();
    dates.forEach(function(date){
      const opt = document.createElement('option');
      opt.value = date;
      opt.textContent = date;
      dateFilter.appendChild(opt);
    });

    function renderDetail() {
      const origin = originFilter.value;
      const date = dateFilter.value;
      const onlyFlight = flightFilter.checked;
      const rows = REPORT_DATA.prices.filter(function(r){
        if (origin && r.originCode !== origin) return false;
        if (date && r.date !== date) return false;
        if (onlyFlight && !r.hasFlight) return false;
        return true;
      }).map(function(r){
        const airlineText = (r.cheapestAirlines || []).join(' / ') || '—';
        const sourceLink = r.sourceUrl
          ? '<a href="' + escapeHtml(r.sourceUrl) + '" target="_blank" rel="noopener">携程</a>'
          : '—';
        return '<tr>' +
          '<td>' + escapeHtml(r.date) + '</td>' +
          '<td>' + escapeHtml(r.origin) + '<br><small class="muted">' + escapeHtml(r.originCode) + '</small></td>' +
          '<td>' + escapeHtml(r.routeId) + '</td>' +
          '<td>' + fmtPrice(r.lowestPrice) + '</td>' +
          '<td>' + fmtPrice(r.avgPrice) + '</td>' +
          '<td>' + escapeHtml(airlineText) + '</td>' +
          '<td>' + fmtInt(r.flightCount) + '</td>' +
          '<td>' + fmtRate(r.discountRate) + '</td>' +
          '<td>' + sourceLink + '</td>' +
        '</tr>';
      }).join('');
      detailTbody.innerHTML = rows || '<tr><td colspan="9" class="no-flight">无匹配记录</td></tr>';
    }

    originFilter.addEventListener('change', renderDetail);
    dateFilter.addEventListener('change', renderDetail);
    flightFilter.addEventListener('change', renderDetail);
    resetFilters.addEventListener('click', function(){
      originFilter.value = '';
      dateFilter.value = '';
      flightFilter.checked = true;
      renderDetail();
    });
    renderDetail();

    // ---------- Canvas 趋势图 ----------
    const seriesConfig = [
      { key: 'dailyLowestPrice', color: '#2563eb', label: '当日所有航线最低价' },
      { key: 'dailyAvgPrice', color: '#10b981', label: '当日航线最低价均价' }
    ];

    function niceStep(range, ticks) {
      if (!range) return 100;
      const raw = range / ticks;
      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const residual = raw / mag;
      if (residual > 5) return 10 * mag;
      if (residual > 2) return 5 * mag;
      if (residual > 1) return 2 * mag;
      return mag;
    }

    function drawChart() {
      const canvas = document.getElementById('priceChart');
      if (!canvas || !canvas.getContext) return;
      const wrap = canvas.parentElement;
      const tooltip = document.getElementById('tooltip');
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      const cssWidth = rect.width - 32; // subtract padding
      const cssHeight = Math.round(cssWidth * (360 / 900));
      canvas.style.width = cssWidth + 'px';
      canvas.style.height = cssHeight + 'px';
      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
      ctx.scale(dpr, dpr);

      const pad = { top: 32, right: 24, bottom: 56, left: 64 };
      const W = cssWidth;
      const H = cssHeight;
      const graphW = W - pad.left - pad.right;
      const graphH = H - pad.top - pad.bottom;

      const daily = (REPORT_DATA.dailySummary || [])
        .map(function(d){
          return {
            date: d.date,
            label: d.date.slice(5).replace('-', '/'),
            dailyLowestPrice: d.dailyLowestPrice,
            dailyAvgPrice: d.dailyAvgPrice
          };
        })
        .filter(function(d){ return d.dailyLowestPrice != null; });

      if (daily.length === 0) {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#9ca3af';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无价格数据', W / 2, H / 2);
        return;
      }

      const allValues = [];
      daily.forEach(function(d){
        if (d.dailyLowestPrice != null) allValues.push(d.dailyLowestPrice);
        if (d.dailyAvgPrice != null) allValues.push(d.dailyAvgPrice);
      });
      let minVal = Math.min.apply(null, allValues);
      let maxVal = Math.max.apply(null, allValues);
      let range = maxVal - minVal;
      if (range === 0) { range = maxVal * 0.2 || 100; }
      minVal = Math.max(0, minVal - range * 0.1);
      maxVal = maxVal + range * 0.1;
      const step = niceStep(maxVal - minVal, 5);
      const yMin = Math.floor(minVal / step) * step;
      const yMax = Math.ceil(maxVal / step) * step;

      ctx.clearRect(0, 0, W, H);

      // grid & y labels
      ctx.lineWidth = 1;
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let y = yMin; y <= yMax + 0.0001; y += step) {
        const py = pad.top + graphH - ((y - yMin) / (yMax - yMin)) * graphH;
        ctx.strokeStyle = '#e5e7eb';
        ctx.beginPath();
        ctx.moveTo(pad.left, py);
        ctx.lineTo(pad.left + graphW, py);
        ctx.stroke();
        ctx.fillStyle = '#6b7280';
        ctx.fillText('¥' + Math.round(y), pad.left - 8, py);
      }

      // x labels
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#6b7280';
      daily.forEach(function(d, i){
        const px = pad.left + (i / (daily.length - 1 || 1)) * graphW;
        ctx.save();
        ctx.translate(px, pad.top + graphH + 10);
        ctx.rotate(-Math.PI / 6);
        ctx.fillText(d.label, 0, 0);
        ctx.restore();
      });

      // axes
      ctx.strokeStyle = '#d1d5db';
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top);
      ctx.lineTo(pad.left, pad.top + graphH);
      ctx.lineTo(pad.left + graphW, pad.top + graphH);
      ctx.stroke();

      // series
      seriesConfig.forEach(function(s){
        const pts = daily
          .map(function(d, i){
            const v = d[s.key];
            if (v == null) return null;
            const px = pad.left + (i / (daily.length - 1 || 1)) * graphW;
            const py = pad.top + graphH - ((v - yMin) / (yMax - yMin)) * graphH;
            return { x: px, y: py, value: v, date: d.date, label: d.label };
          })
          .filter(function(p){ return p != null; });
        if (pts.length === 0) return;

        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();

        ctx.fillStyle = '#fff';
        pts.forEach(function(p){
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
      });

      // hover interaction
      function nearestIndex(mx) {
        const x = mx - pad.left;
        if (x < 0 || x > graphW) return -1;
        return Math.round((x / graphW) * (daily.length - 1));
      }

      wrap.onmousemove = function(e) {
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (canvas.width / rect.width / dpr);
        const idx = nearestIndex(mx);
        if (idx < 0 || idx >= daily.length) {
          tooltip.style.display = 'none';
          return;
        }
        const d = daily[idx];
        let html = '<strong>' + escapeHtml(d.date) + '</strong><br>';
        html += '最低价：' + fmtPrice(d.dailyLowestPrice) + '<br>';
        html += '均价：' + fmtPrice(d.dailyAvgPrice);
        tooltip.innerHTML = html;
        tooltip.style.display = 'block';
        const px = pad.left + (idx / (daily.length - 1 || 1)) * graphW;
        const py = pad.top + graphH - ((d.dailyLowestPrice - yMin) / (yMax - yMin)) * graphH;
        tooltip.style.left = Math.min(px + 12, cssWidth - tooltip.offsetWidth - 8) + 'px';
        tooltip.style.top = Math.max(py - tooltip.offsetHeight - 8, 8) + 'px';
      };

      wrap.onmouseleave = function() {
        tooltip.style.display = 'none';
      };
    }

    drawChart();
    window.addEventListener('resize', drawChart);
  </script>
</body>
</html>
`;
}

export function generateReport(options = {}) {
  const data = loadCleanData(options.inputPath);
  const html = buildHtml(data);
  const bestCombo = computeBestCombo(data);

  let outputPath = options.outputPath;
  if (!outputPath) {
    const suffix = (data.meta?.dateRangeStart || 'unknown').replace(/-/g, '');
    outputPath = join(REPORTS_DIR, `jiamusi_flight_report_${suffix}.html`);
  }

  writeFileSync(outputPath, html, 'utf8');

  let comboOutputPath = options.comboOutputPath;
  if (comboOutputPath !== false) {
    if (!comboOutputPath) {
      const suffix = (data.meta?.dateRangeStart || 'unknown').replace(/-/g, '');
      comboOutputPath = join(REPORTS_DIR, `jiamusi_best_combo_${suffix}.json`);
    }
    writeFileSync(comboOutputPath, JSON.stringify(bestCombo, null, 2), 'utf8');
  }

  const result = {
    path: outputPath,
    comboPath: comboOutputPath !== false ? comboOutputPath : null,
    htmlLength: html.length,
    pricesCount: (data.prices || []).length,
    days: (data.dailySummary || []).length,
    routes: (data.routeSummary || []).length,
    bestCombo: {
      totalPrice: bestCombo.totalPrice,
      daysWithPrice: bestCombo.daysWithPrice,
      daysMissing: bestCombo.daysMissing,
      missingDates: bestCombo.missingDates,
    },
  };

  if (!options.silent) {
    console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL('gen-jmu-report.mjs', 'file://' + process.argv[1].replace(/\\/g, '/')).href;
if (isMain) {
  generateReport();
}
