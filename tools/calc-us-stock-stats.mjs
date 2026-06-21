#!/usr/bin/env node
/**
 * 计算美股关键统计指标
 * 输入：reports/us_stock_raw_<YYYYMMDD>.json
 * 输出：reports/us_stock_stats_<YYYYMMDD>.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function getDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function loadJSON(path) {
  if (!existsSync(path)) {
    throw new Error(`文件不存在: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function safeLoadJSON(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function fmtNumber(n, digits = 2) {
  return n == null ? '—' : Number(n).toFixed(digits);
}

function fmtInt(n) {
  return n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtPercent(n, digits = 2) {
  return n == null ? '—' : `${n >= 0 ? '+' : ''}${Number(n).toFixed(digits)}%`;
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdDev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length);
}

function parseDateString(dateStr) {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10) - 1;
  const day = parseInt(dateStr.slice(6, 8), 10);
  return new Date(year, month, day);
}

function formatDateString(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function addDays(dateStr, days) {
  const d = parseDateString(dateStr);
  d.setDate(d.getDate() + days);
  return formatDateString(d);
}

function computeVolumeChange(current, previous) {
  if (previous == null || previous === 0) return null;
  return +(((current - previous) / previous) * 100).toFixed(2);
}

// 行业映射（与 tools/fetch-us-stock-raw.mjs 中的 STOCK_SYMBOLS 保持一致）
const SECTOR_MAP = {
  AAPL: '科技/硬件',
  SNDK: '科技/半导体',
  GLW: '科技/材料',
  INTC: '科技/半导体',
  SMCI: '科技/硬件',
  ACN: '信息技术服务',
  CTSH: '信息技术服务',
  KR: '消费零售',
  STLD: '工业材料',
  TSLA: '汽车/科技',
  NVDA: '科技/半导体',
  MSFT: '科技/软件',
  AMZN: '科技/电商',
  GOOGL: '科技/互联网',
  META: '科技/互联网',
  NFLX: '科技/流媒体',
  AMD: '科技/半导体',
  BABA: '科技/电商',
  JD: '科技/电商',
  XOM: '能源',
  JPM: '金融',
  BAC: '金融',
  WMT: '消费零售',
};

const INDEX_SYMBOLS = new Set(['IXIC', 'DJI', 'INX']);

/**
 * 加载历史成交量数据，用于计算环比/同比。
 * 依次尝试 stats、indices/focus、raw 文件，支持新旧两种 raw 格式。
 */
function loadPriorVolumes(today, daysBackStart, daysBackEnd) {
  for (let i = daysBackStart; i <= daysBackEnd; i++) {
    const candidate = addDays(today, -i);
    const statsPath = join(ROOT, 'reports', `us_stock_stats_${candidate}.json`);
    const rawPath = join(ROOT, 'reports', `us_stock_raw_${candidate}.json`);
    const indicesPath = join(ROOT, 'reports', `us_stock_indices_${candidate}.json`);
    const focusPath = join(ROOT, 'reports', `us_stock_focus_${candidate}.json`);

    const stats = safeLoadJSON(statsPath);
    const raw = safeLoadJSON(rawPath);
    const indicesFile = safeLoadJSON(indicesPath);
    const focusFile = safeLoadJSON(focusPath);

    const indexVolumes = new Map();
    const focusVolumes = new Map();

    // 指数成交量：stats -> indices 文件 -> raw（新/旧格式）
    if (stats?.indices) {
      for (const idx of stats.indices) {
        if (idx.volume != null) indexVolumes.set(idx.symbol, idx.volume);
      }
    }
    if (Array.isArray(indicesFile)) {
      for (const idx of indicesFile) {
        if (idx.volume != null) indexVolumes.set(idx.symbol, idx.volume);
      }
    }
    if (raw?.indices) {
      for (const idx of raw.indices) {
        if (idx.volume != null) indexVolumes.set(idx.symbol, idx.volume);
      }
    }
    if (Array.isArray(raw)) {
      for (const q of raw) {
        if (!q.ok) continue;
        if (INDEX_SYMBOLS.has(q.symbol) && q.volume != null) {
          indexVolumes.set(q.symbol, q.volume);
        }
      }
    }

    // 个股成交量：focus 文件 -> raw（新/旧格式）
    if (focusFile?.quotes) {
      for (const q of focusFile.quotes) {
        if (q.volume != null) focusVolumes.set(q.symbol, q.volume);
      }
    }
    if (raw?.focus) {
      for (const q of raw.focus) {
        if (q.volume != null) focusVolumes.set(q.symbol, q.volume);
      }
    }
    if (Array.isArray(raw)) {
      for (const q of raw) {
        if (!q.ok) continue;
        if (!INDEX_SYMBOLS.has(q.symbol) && q.volume != null) {
          focusVolumes.set(q.symbol, q.volume);
        }
      }
    }

    if (indexVolumes.size > 0 || focusVolumes.size > 0) {
      return { date: candidate, indexVolumes, focusVolumes };
    }
  }
  return null;
}

function computeMatchedVolumeChange(quotes, priorVolumes) {
  if (!priorVolumes) return { dayOverDayPercent: null, yearOverYearPercent: null, matchedCount: 0 };

  let currentSum = 0;
  let prevSum = 0;
  let matchedCount = 0;
  for (const q of quotes) {
    const prevVol = priorVolumes.get(q.symbol);
    if (prevVol != null && q.volume != null) {
      currentSum += q.volume;
      prevSum += prevVol;
      matchedCount++;
    }
  }
  return {
    dayOverDayPercent: computeVolumeChange(currentSum, prevSum),
    matchedCount,
    matchedCurrentVolume: currentSum,
    matchedPrevVolume: prevSum,
  };
}

function main() {
  const today = process.argv[2] || getDateString();
  const rawPath = join(ROOT, 'reports', `us_stock_raw_${today}.json`);
  const outPath = join(ROOT, 'reports', `us_stock_stats_${today}.json`);

  const raw = loadJSON(rawPath);
  const indices = raw.indices || [];
  const quotes = raw.focus || [];

  // 历史成交量：环比取最近 1-7 个交易日，同比取约 365 天前后（当前环境通常不存在）
  const prevVolumes = loadPriorVolumes(today, 1, 7);
  const prevYearVolumes = loadPriorVolumes(today, 363, 368);

  // 大盘指数统计
  const indexStats = indices.map(item => {
    const price = item.price;
    const prev = item.prevClose;
    const change = price - prev;
    const changePercent = (change / prev) * 100;
    return {
      symbol: item.symbol,
      name: item.name,
      close: price,
      prevClose: prev,
      change: +change.toFixed(4),
      changePercent: +changePercent.toFixed(2),
      dayRangeLow: item.low,
      dayRangeHigh: item.high,
      volume: item.volume,
      volumeChange: {
        dayOverDayPercent: computeVolumeChange(item.volume, prevVolumes?.indexVolumes.get(item.symbol)),
        yearOverYearPercent: computeVolumeChange(item.volume, prevYearVolumes?.indexVolumes.get(item.symbol)),
      },
    };
  });

  // 个股统计
  const changePercents = quotes.map(q => q.changePercent);
  const changes = quotes.map(q => q.change);
  const volumes = quotes.map(q => q.volume).filter(v => v != null);
  const marketCaps = quotes.map(q => q.marketCap).filter(m => m != null);

  const upCount = changePercents.filter(p => p > 0).length;
  const downCount = changePercents.filter(p => p < 0).length;
  const flatCount = changePercents.filter(p => p === 0).length;

  const avgChangePercent = mean(changePercents);
  const medianChangePercent = median(changePercents);
  const volatilityChangePercent = stdDev(changePercents);

  const avgChange = mean(changes);
  const medianChange = median(changes);
  const volatilityChange = stdDev(changes);

  // 领涨/领跌 top5（互斥，避免同一标的同时出现在两边）
  const sortedByChange = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
  const topGainers = sortedByChange.slice(0, 5).map(q => ({
    symbol: q.symbol,
    name: q.name,
    close: q.price,
    changePercent: q.changePercent,
    change: q.change,
    volume: q.volume,
    marketCap: q.marketCap,
  }));
  const gainerSymbols = new Set(topGainers.map(s => s.symbol));
  const topLosers = [];
  for (let i = sortedByChange.length - 1; i >= 0 && topLosers.length < 5; i--) {
    const q = sortedByChange[i];
    if (gainerSymbols.has(q.symbol)) continue;
    topLosers.push({
      symbol: q.symbol,
      name: q.name,
      close: q.price,
      changePercent: q.changePercent,
      change: q.change,
      volume: q.volume,
      marketCap: q.marketCap,
    });
  }

  // 成交量/市值摘要
  const totalVolume = volumes.reduce((a, b) => a + b, 0);
  const totalMarketCap = marketCaps.reduce((a, b) => a + b, 0);

  const matchedPrevDay = computeMatchedVolumeChange(quotes, prevVolumes?.focusVolumes);
  const matchedPrevYear = computeMatchedVolumeChange(quotes, prevYearVolumes?.focusVolumes);

  // 行业热点：按行业分组计算平均涨跌幅
  const sectorGroups = {};
  for (const q of quotes) {
    const sector = SECTOR_MAP[q.symbol] || '其他';
    if (!sectorGroups[sector]) {
      sectorGroups[sector] = { symbols: [], changePercents: [] };
    }
    sectorGroups[sector].symbols.push(q.symbol);
    sectorGroups[sector].changePercents.push(q.changePercent);
  }
  const sectorHotspots = Object.entries(sectorGroups)
    .map(([sector, group]) => ({
      sector,
      symbols: group.symbols,
      count: group.symbols.length,
      avgChangePercent: +mean(group.changePercents).toFixed(2),
    }))
    .sort((a, b) => b.avgChangePercent - a.avgChangePercent);

  const top3GainerSectors = sectorHotspots.slice(0, 3);
  const top3LoserSectors = sectorHotspots.slice(-3).reverse();

  const advanceDeclineRatio = downCount === 0 ? null : +(upCount / downCount).toFixed(2);

  const stats = {
    date: today,
    generatedAt: new Date().toISOString(),
    basedOn: raw.basedOn ? `${raw.basedOn} 美股收盘` : `${today} 美股收盘`,
    indices: indexStats,
    stocks: {
      total: quotes.length,
      up: upCount,
      down: downCount,
      flat: flatCount,
      upRatio: +(upCount / quotes.length * 100).toFixed(2),
      downRatio: +(downCount / quotes.length * 100).toFixed(2),
      flatRatio: +(flatCount / quotes.length * 100).toFixed(2),
      advanceDeclineRatio,
      avgChangePercent: +avgChangePercent.toFixed(2),
      medianChangePercent: +medianChangePercent.toFixed(2),
      volatilityChangePercent: +volatilityChangePercent.toFixed(2),
      avgChange: +avgChange.toFixed(4),
      medianChange: +medianChange.toFixed(4),
      volatilityChange: +volatilityChange.toFixed(4),
      totalVolume,
      avgVolume: volumes.length ? +(totalVolume / volumes.length).toFixed(0) : null,
      totalMarketCap,
      volumeChange: {
        dayOverDayPercent: matchedPrevDay.dayOverDayPercent,
        yearOverYearPercent: matchedPrevYear.dayOverDayPercent,
        matchedSampleCount: matchedPrevDay.matchedCount,
      },
      topGainers,
      topLosers,
    },
    sectorHotspots,
    top3GainerSectors,
    top3LoserSectors,
  };

  writeFileSync(outPath, JSON.stringify(stats, null, 2));

  console.log(`# 美股关键统计指标（基于 ${stats.basedOn}）\n`);
  console.log(`生成时间：${stats.generatedAt}\n`);

  console.log(`## 一、大盘指数涨跌`);
  console.log(`| 指数 | 收盘 | 前收 | 涨跌额 | 涨跌幅 | 日内区间 | 成交量环比 | 成交量同比 |`);
  console.log(`|---|---:|---:|---:|---:|---:|---:|---:|`);
  for (const idx of indexStats) {
    console.log(
      `| ${idx.symbol} | ${fmtNumber(idx.close)} | ${fmtNumber(idx.prevClose)} | ` +
      `${fmtNumber(idx.change)} | ${fmtPercent(idx.changePercent)} | ` +
      `${fmtNumber(idx.dayRangeLow)} – ${fmtNumber(idx.dayRangeHigh)} | ` +
      `${fmtPercent(idx.volumeChange.dayOverDayPercent)} | ` +
      `${fmtPercent(idx.volumeChange.yearOverYearPercent)} |`
    );
  }

  console.log(`\n## 二、个股涨跌家数统计`);
  console.log(`| 总样本 | 上涨 | 下跌 | 平盘 | 上涨占比 | 下跌占比 | 平盘占比 | 涨跌比 |`);
  console.log(`|---:|---:|---:|---:|---:|---:|---:|---:|`);
  console.log(
    `| ${stats.stocks.total} | ${stats.stocks.up} | ${stats.stocks.down} | ${stats.stocks.flat} | ` +
    `${stats.stocks.upRatio}% | ${stats.stocks.downRatio}% | ${stats.stocks.flatRatio}% | ` +
    `${stats.stocks.advanceDeclineRatio == null ? '—' : stats.stocks.advanceDeclineRatio} |`
  );

  console.log(`\n## 三、个股涨跌幅分布`);
  console.log(`| 平均涨跌幅 | 中位数 | 波动率（标准差） |`);
  console.log(`|---:|---:|---:|`);
  console.log(
    `| ${fmtPercent(stats.stocks.avgChangePercent)} | ` +
    `${fmtPercent(stats.stocks.medianChangePercent)} | ` +
    `${fmtPercent(stats.stocks.volatilityChangePercent)} |`
  );

  console.log(`\n## 四、成交量变化（匹配样本）`);
  console.log(`| 总成交量 | 平均成交量 | 环比 | 同比 | 匹配样本数 |`);
  console.log(`|---:|---:|---:|---:|---:|`);
  console.log(
    `| ${fmtInt(stats.stocks.totalVolume)} | ${fmtInt(stats.stocks.avgVolume)} | ` +
    `${fmtPercent(stats.stocks.volumeChange.dayOverDayPercent)} | ` +
    `${fmtPercent(stats.stocks.volumeChange.yearOverYearPercent)} | ` +
    `${stats.stocks.volumeChange.matchedSampleCount} |`
  );

  console.log(`\n## 五、领涨 TOP5`);
  console.log(`| 标的 | 名称 | 收盘 | 涨跌额 | 涨跌幅 |`);
  console.log(`|---|---:|---:|---:|---:|`);
  for (const s of topGainers) {
    console.log(`| ${s.symbol} | ${s.name} | ${fmtNumber(s.close)} | ${fmtNumber(s.change)} | ${fmtPercent(s.changePercent)} |`);
  }

  console.log(`\n## 六、领跌 TOP5`);
  console.log(`| 标的 | 名称 | 收盘 | 涨跌额 | 涨跌幅 |`);
  console.log(`|---|---:|---:|---:|---:|`);
  for (const s of topLosers) {
    console.log(`| ${s.symbol} | ${s.name} | ${fmtNumber(s.close)} | ${fmtNumber(s.change)} | ${fmtPercent(s.changePercent)} |`);
  }

  console.log(`\n## 七、行业热点`);
  console.log(`| 行业 | 标的 | 平均涨跌幅 |`);
  console.log(`|---|---:|---:|`);
  for (const h of sectorHotspots) {
    console.log(`| ${h.sector} | ${h.symbols.join(', ')} | ${fmtPercent(h.avgChangePercent)} |`);
  }

  console.log(`\n## 八、板块 Top3 涨跌`);
  console.log(`\n### 领涨 Top3`);
  for (const s of top3GainerSectors) {
    console.log(`- ${s.sector}（${s.symbols.join(', ')}）：${fmtPercent(s.avgChangePercent)}`);
  }
  console.log(`\n### 领跌 Top3`);
  for (const s of top3LoserSectors) {
    console.log(`- ${s.sector}（${s.symbols.join(', ')}）：${fmtPercent(s.avgChangePercent)}`);
  }

  console.log(`\n已写入 ${outPath}`);
}

main();
