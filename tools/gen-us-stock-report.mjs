#!/usr/bin/env node
/**
 * 生成美股日报
 * 输入：reports/us_stock_stats_<YYYYMMDD>.json
 *       reports/us_stock_focus_<YYYYMMDD>.json
 *       reports/us_stock_raw_<YYYYMMDD>.json
 * 输出：reports/us_stock_daily_<YYYYMMDD>.md
 *       reports/us_stock_news_<YYYYMMDD>.html
 *       reports/us_stock_report_<YYYYMMDD>.html （兼容旧路径，内容与 HTML 日报一致）
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const today = process.argv[2] || new Date().toISOString().slice(0, 10).replace(/-/g, '');
const statsPath = join(ROOT, 'reports', `us_stock_stats_${today}.json`);
const focusPath = join(ROOT, 'reports', `us_stock_focus_${today}.json`);
const rawPath = join(ROOT, 'reports', `us_stock_raw_${today}.json`);

if (!existsSync(statsPath)) {
  console.error(`错误：统计文件不存在 ${statsPath}`);
  process.exit(1);
}

const stats = JSON.parse(readFileSync(statsPath, 'utf8'));
const focus = existsSync(focusPath) ? JSON.parse(readFileSync(focusPath, 'utf8')) : { quotes: [] };
const raw = existsSync(rawPath) ? JSON.parse(readFileSync(rawPath, 'utf8')) : { news: [] };

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

function fmtNumber(n, digits = 2) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtInt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtPercentHtml(n, digits = 2) {
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  const cls = n >= 0 ? 'up' : 'down';
  return `<span class="${cls}">${sign}${Number(n).toFixed(digits)}%</span>`;
}

function fmtChangeHtml(n, digits = 2) {
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  const cls = n >= 0 ? 'up' : 'down';
  return `<span class="${cls}">${sign}${Number(n).toFixed(digits)}</span>`;
}

function fmtPercentMd(n, digits = 2) {
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(digits)}%`;
}

function fmtChangeMd(n, digits = 2) {
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(digits)}`;
}

function marketCap(n) {
  if (n == null) return '—';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return fmtInt(n);
}

function turnover(n) {
  if (n == null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return fmtInt(n);
}

function formatNewsTime(n) {
  if (!n) return '—';
  const ts = Number(n) * 1000;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function buildMarketSummary() {
  const idxSummary = stats.indices.map(idx => {
    const direction = idx.changePercent >= 0 ? '上涨' : '下跌';
    return `${idx.name} ${direction} ${fmtPercentMd(idx.changePercent)}`;
  }).join('，');

  const gainerSector = (stats.top3GainerSectors || [])[0];
  const loserSector = (stats.top3LoserSectors || [])[0];
  let sectorSentence = '';
  if (gainerSector && gainerSector.avgChangePercent > 0) {
    sectorSentence += `；领涨板块为 **${gainerSector.sector}**（平均 ${fmtPercentMd(gainerSector.avgChangePercent)}）`;
  }
  if (loserSector && loserSector.avgChangePercent < 0) {
    sectorSentence += `，${loserSector.sector} 板块承压（平均 ${fmtPercentMd(loserSector.avgChangePercent)}）`;
  }

  return `${stats.basedOn}，${idxSummary}。重点观察的 ${stats.stocks.total} 只活跃标的中，上涨 ${stats.stocks.up} 只，下跌 ${stats.stocks.down} 只，上涨占比 ${stats.stocks.upRatio}%${sectorSentence}。`;
}

// ---------- Markdown ----------
const indicesMdRows = stats.indices.map(idx =>
  `| ${idx.name}（${idx.symbol}） | ${fmtNumber(idx.close)} | ${fmtNumber(idx.prevClose)} | ${fmtChangeMd(idx.change)} | ${fmtPercentMd(idx.changePercent)} | ${fmtNumber(idx.dayRangeLow)} – ${fmtNumber(idx.dayRangeHigh)} |`
).join('\n');

const gainerSectorMdRows = (stats.top3GainerSectors || []).map(s =>
  `| ${s.sector} | ${s.symbols.join(', ')} | ${s.count} | ${fmtPercentMd(s.avgChangePercent)} |`
).join('\n');

const loserSectorMdRows = (stats.top3LoserSectors || []).map(s =>
  `| ${s.sector} | ${s.symbols.join(', ')} | ${s.count} | ${fmtPercentMd(s.avgChangePercent)} |`
).join('\n');

const focusMdRows = focus.quotes.map(q =>
  `| ${q.symbol} | ${q.name} | ${fmtNumber(q.price)} | ${fmtChangeMd(q.change)} | ${fmtPercentMd(q.changePercent)} | ${turnover(q.turnover)} | ${(q.reasons || []).join('、')} |`
).join('\n');

const newsMdRows = (raw.news || []).map((n, i) => {
  const titleLink = n.url ? `[${n.title}](${n.url})` : n.title;
  return `| ${i + 1} | ${titleLink} | ${(n.intro || '').slice(0, 120).replace(/\|/g, '｜')}${(n.intro || '').length > 120 ? '…' : ''} | ${n.mediaName || '—'} | ${formatNewsTime(n.ctime)} |`;
}).join('\n');

const md = `# 美股日报（${stats.basedOn.split(' ')[0]}）

> **报告日期**：${stats.basedOn.split(' ')[0]}（北京时间）<br>
> **数据截至**：${stats.basedOn}<br>
> **数据来源**：新浪财经 \`hq.sinajs.cn\`

---

## 市场综述

${buildMarketSummary()}

---

## 一、三大指数

| 指数 | 收盘 | 前收 | 涨跌额 | 涨跌幅 | 日内区间 |
|---|---:|---:|---:|---:|---|
${indicesMdRows}

> 原始文件：\`reports/us_stock_stats_${today}.json\`

---

## 二、板块热点

### 2.1 领涨板块 Top3

| 行业 | 包含标的 | 标的数 | 平均涨跌幅 |
|---|---:|---:|---:|
${gainerSectorMdRows}

### 2.2 领跌板块 Top3

| 行业 | 包含标的 | 标的数 | 平均涨跌幅 |
|---|---:|---:|---:|
${loserSectorMdRows}

---

## 三、重点个股

| 代码 | 名称 | 最新价 | 涨跌额 | 涨跌幅 | 成交额 | 入选理由 |
|---|---:|---:|---:|---:|---:|---|
${focusMdRows}

> 原始文件：\`reports/us_stock_focus_${today}.json\`

---

## 四、要闻摘要

| # | 标题 | 摘要 | 来源 | 时间 |
|---:|---|---|---|---|
${newsMdRows}

---

*本报告由 myteam 自动生成，仅供内部参考，不构成投资建议。*
`;

const mdPath = join(ROOT, 'reports', `us_stock_daily_${today}.md`);
writeFileSync(mdPath, md, 'utf8');
console.log(`Markdown 日报已生成：${mdPath}`);

// ---------- HTML ----------
const indicesRows = stats.indices.map(idx => `
  <tr>
    <td><strong>${idx.name}</strong><br><small>(${idx.symbol})</small></td>
    <td>${fmtNumber(idx.close)}</td>
    <td>${fmtNumber(idx.prevClose)}</td>
    <td>${fmtChangeHtml(idx.change)}</td>
    <td>${fmtPercentHtml(idx.changePercent)}</td>
    <td>${fmtNumber(idx.dayRangeLow)} – ${fmtNumber(idx.dayRangeHigh)}</td>
  </tr>
`).join('');

const focusRows = focus.quotes.map(q => `
  <tr>
    <td><strong>${q.symbol}</strong></td>
    <td>${q.name}</td>
    <td>${fmtNumber(q.price)}</td>
    <td>${fmtChangeHtml(q.change)}</td>
    <td>${fmtPercentHtml(q.changePercent)}</td>
    <td>${turnover(q.turnover)}</td>
    <td>${(q.reasons || []).join('、')}</td>
  </tr>
`).join('');

const gainerSectorRows = (stats.top3GainerSectors || []).map(s => `
  <tr>
    <td><strong>${s.sector}</strong></td>
    <td>${s.symbols.join(', ')}</td>
    <td>${s.count}</td>
    <td>${fmtPercentHtml(s.avgChangePercent)}</td>
  </tr>
`).join('');

const loserSectorRows = (stats.top3LoserSectors || []).map(s => `
  <tr>
    <td><strong>${s.sector}</strong></td>
    <td>${s.symbols.join(', ')}</td>
    <td>${s.count}</td>
    <td>${fmtPercentHtml(s.avgChangePercent)}</td>
  </tr>
`).join('');

const newsRows = (raw.news || []).map((n, i) => `
  <tr>
    <td>${i + 1}</td>
    <td><a href="${n.url || n.wapUrl || '#'}" target="_blank" rel="noopener">${n.title}</a></td>
    <td>${(n.intro || '').slice(0, 160).replace(/</g, '&lt;')}${(n.intro || '').length > 160 ? '…' : ''}</td>
    <td>${n.mediaName || '—'}</td>
    <td>${formatNewsTime(n.ctime)}</td>
  </tr>
`).join('');

const summaryText = buildMarketSummary();

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>美股日报 · ${today}</title>
  <style>
    :root {
      --bg: #f7f8fa;
      --card: #ffffff;
      --text: #1f2937;
      --muted: #6b7280;
      --border: #e5e7eb;
      --up: #dc2626;
      --down: #16a34a;
      --accent: #2563eb;
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
      background: linear-gradient(135deg, #1e3a8a, #2563eb);
      color: #fff;
      padding: 2rem 1rem;
      text-align: center;
    }
    header h1 { margin: 0; font-size: 1.75rem; }
    header p { margin: 0.5rem 0 0; opacity: 0.9; font-size: 0.95rem; }
    main { max-width: 1100px; margin: 0 auto; padding: 1.5rem 1rem; }
    section { margin-bottom: 2rem; }
    h2 { font-size: 1.25rem; margin-bottom: 0.75rem; border-left: 4px solid var(--accent); padding-left: 0.6rem; }
    .summary-box {
      background: var(--card);
      border-radius: 0.75rem;
      padding: 1.25rem;
      border: 1px solid var(--border);
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      line-height: 1.7;
    }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
    .card {
      background: var(--card);
      border-radius: 0.75rem;
      padding: 1.25rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      border: 1px solid var(--border);
    }
    .card h3 { margin: 0 0 0.25rem; font-size: 0.9rem; color: var(--muted); }
    .card .value { font-size: 1.5rem; font-weight: 700; }
    .card .sub { font-size: 0.95rem; margin-top: 0.25rem; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--card);
      border-radius: 0.75rem;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      border: 1px solid var(--border);
    }
    th, td { padding: 0.75rem 0.6rem; text-align: right; border-bottom: 1px solid var(--border); }
    th { background: #f3f4f6; font-weight: 600; color: var(--muted); font-size: 0.85rem; }
    td:first-child, th:first-child { text-align: left; }
    tr:last-child td { border-bottom: none; }
    .up { color: var(--up); font-weight: 600; }
    .down { color: var(--down); font-weight: 600; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; }
    .summary .card { text-align: center; }
    .summary .card .value { font-size: 1.75rem; }
    footer {
      text-align: center;
      padding: 1.5rem 1rem;
      color: var(--muted);
      font-size: 0.85rem;
    }
    @media (max-width: 640px) {
      header h1 { font-size: 1.4rem; }
      table { font-size: 0.85rem; }
      th, td { padding: 0.55rem 0.4rem; }
    }
  </style>
</head>
<body>
  <header>
    <h1>美股日报 · ${today}</h1>
    <p>数据来源：Sina Finance | 生成时间：${fmtDate(stats.generatedAt)} | 基准：${stats.basedOn}</p>
  </header>

  <main>
    <section>
      <h2>市场综述</h2>
      <div class="summary-box">${summaryText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</div>
    </section>

    <section>
      <h2>一、三大指数</h2>
      <div class="cards">
        ${stats.indices.map(idx => `
        <div class="card">
          <h3>${idx.name} <span style="font-weight:400">(${idx.symbol})</span></h3>
          <div class="value">${fmtNumber(idx.close)}</div>
          <div class="sub">${fmtChangeHtml(idx.change)} &nbsp; ${fmtPercentHtml(idx.changePercent)}</div>
          <div class="sub" style="color:var(--muted);font-size:0.85rem">区间 ${fmtNumber(idx.dayRangeLow)} – ${fmtNumber(idx.dayRangeHigh)}</div>
        </div>
        `).join('')}
      </div>
      <table style="margin-top:1rem">
        <thead>
          <tr>
            <th>指数</th>
            <th>收盘</th>
            <th>前收</th>
            <th>涨跌额</th>
            <th>涨跌幅</th>
            <th>日内区间</th>
          </tr>
        </thead>
        <tbody>${indicesRows}</tbody>
      </table>
    </section>

    <section>
      <h2>二、个股涨跌统计</h2>
      <div class="summary">
        <div class="card"><h3>总样本</h3><div class="value">${stats.stocks.total}</div></div>
        <div class="card"><h3>上涨</h3><div class="value up">${stats.stocks.up}</div></div>
        <div class="card"><h3>下跌</h3><div class="value down">${stats.stocks.down}</div></div>
        <div class="card"><h3>平盘</h3><div class="value">${stats.stocks.flat}</div></div>
      </div>
      <table style="margin-top:1rem">
        <thead>
          <tr>
            <th>上涨占比</th>
            <th>下跌占比</th>
            <th>平盘占比</th>
            <th>平均涨跌幅</th>
            <th>中位数</th>
            <th>波动率（标准差）</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${stats.stocks.upRatio}%</td>
            <td>${stats.stocks.downRatio}%</td>
            <td>${stats.stocks.flatRatio}%</td>
            <td>${fmtPercentHtml(stats.stocks.avgChangePercent)}</td>
            <td>${fmtPercentHtml(stats.stocks.medianChangePercent)}</td>
            <td>${fmtPercentHtml(stats.stocks.volatilityChangePercent)}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>三、板块热点</h2>
      <h3 style="font-size:1rem;color:var(--muted);margin:1rem 0 0.5rem">领涨板块 Top3</h3>
      <table>
        <thead>
          <tr>
            <th>行业</th>
            <th>包含标的</th>
            <th>标的数</th>
            <th>平均涨跌幅</th>
          </tr>
        </thead>
        <tbody>${gainerSectorRows}</tbody>
      </table>
      <h3 style="font-size:1rem;color:var(--muted);margin:1.5rem 0 0.5rem">领跌板块 Top3</h3>
      <table>
        <thead>
          <tr>
            <th>行业</th>
            <th>包含标的</th>
            <th>标的数</th>
            <th>平均涨跌幅</th>
          </tr>
        </thead>
        <tbody>${loserSectorRows}</tbody>
      </table>
    </section>

    <section>
      <h2>四、重点个股</h2>
      <table>
        <thead>
          <tr>
            <th>代码</th>
            <th>名称</th>
            <th>最新价</th>
            <th>涨跌额</th>
            <th>涨跌幅</th>
            <th>成交额</th>
            <th>入选理由</th>
          </tr>
        </thead>
        <tbody>${focusRows}</tbody>
      </table>
    </section>

    <section>
      <h2>五、要闻摘要</h2>
      <table>
        <thead>
          <tr><th>序号</th><th>标题</th><th>摘要</th><th>来源</th><th>时间</th></tr>
        </thead>
        <tbody>${newsRows}</tbody>
      </table>
    </section>
  </main>

  <footer>
    本报告由 myteam 自动生成，仅供内部参考，不构成投资建议。
  </footer>
</body>
</html>
`;

const htmlPath = join(ROOT, 'reports', `us_stock_news_${today}.html`);
writeFileSync(htmlPath, html, 'utf8');
console.log(`HTML 日报已生成：${htmlPath}`);
console.log(`HTML 文件大小：${html.length} 字节`);

// 兼容旧路径：同时输出 us_stock_report_<YYYYMMDD>.html
const reportHtmlPath = join(ROOT, 'reports', `us_stock_report_${today}.html`);
writeFileSync(reportHtmlPath, html, 'utf8');
console.log(`兼容 HTML 报告已生成：${reportHtmlPath}`);
