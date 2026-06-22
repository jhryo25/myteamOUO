#!/usr/bin/env node
/**
 * 生成美股重点关注个股列表
 * 输入：reports/us_stock_raw_<YYYYMMDD>.json
 * 输出：reports/us_stock_focus_<YYYYMMDD>.json
 *
 * 筛选规则：
 * - 涨幅前 5
 * - 跌幅前 5
 * - 成交额（成交量 × 收盘价）前 10
 * 去重后合并输出，保证至少 15 只个股。
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

// 与 tools/fetch-us-stock-raw.mjs / tools/calc-us-stock-stats.mjs 保持一致
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

function computeTurnover(q) {
  if (q.price == null || q.volume == null) return null;
  return +(q.price * q.volume).toFixed(4);
}

function enrich(q) {
  const sector = SECTOR_MAP[q.symbol] || '其他';
  const turnover = computeTurnover(q);
  return {
    ...q,
    sector,
    turnover,
  };
}

function main() {
  const today = process.argv[2] || getDateString();
  const rawPath = join(ROOT, 'reports', `us_stock_raw_${today}.json`);
  const outPath = join(ROOT, 'reports', `us_stock_focus_${today}.json`);

  const raw = loadJSON(rawPath);
  const quotes = (raw.focus || [])
    .filter(q => q.ok && q.price != null && q.changePercent != null)
    .map(enrich)
    .filter(q => q.turnover != null);

  if (quotes.length === 0) {
    throw new Error('没有可用的个股数据');
  }

  const sortedByChange = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
  const sortedByTurnover = [...quotes].sort((a, b) => b.turnover - a.turnover);

  const topGainers = sortedByChange.slice(0, 5);
  const topLosers = sortedByChange.slice(-5).reverse();
  const topTurnover = sortedByTurnover.slice(0, 10);

  const selected = new Map();
  const add = (q, reason) => {
    const existing = selected.get(q.symbol);
    if (existing) {
      existing.reasons.push(reason);
      return;
    }
    selected.set(q.symbol, { ...q, reasons: [reason] });
  };

  topGainers.forEach(q => add(q, '涨幅前5'));
  topLosers.forEach(q => add(q, '跌幅前5'));
  topTurnover.forEach(q => add(q, '成交额前10'));

  // 若去重后不足 15 只，按成交额顺位补齐
  for (const q of sortedByTurnover) {
    if (selected.size >= 15) break;
    add(q, '成交额顺位补齐');
  }

  // 最终按成交额降序输出，兼顾阅读优先级
  const focusQuotes = Array.from(selected.values())
    .sort((a, b) => b.turnover - a.turnover);

  const requiredFields = ['symbol', 'name', 'changePercent', 'turnover', 'sector'];
  const incomplete = focusQuotes.filter(q =>
    requiredFields.some(field => q[field] == null || q[field] === '')
  );
  if (incomplete.length > 0) {
    throw new Error(`以下个股缺少必填字段: ${incomplete.map(q => q.symbol).join(', ')}`);
  }

  const output = {
    date: today,
    generatedAt: new Date().toISOString(),
    basedOn: raw.basedOn || today,
    source: raw.source || 'Sina Finance',
    total: focusQuotes.length,
    quotes: focusQuotes,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`已生成重点关注个股：${outPath}`);
  console.log(`共 ${focusQuotes.length} 只`);
  console.log('\n涨幅前5:');
  topGainers.forEach(q => console.log(`  ${q.symbol} ${q.name} ${q.changePercent}%`));
  console.log('\n跌幅前5:');
  topLosers.forEach(q => console.log(`  ${q.symbol} ${q.name} ${q.changePercent}%`));
  console.log('\n成交额前10:');
  topTurnover.forEach(q => console.log(`  ${q.symbol} ${q.name} ${Math.round(q.turnover).toLocaleString()} (${q.sector})`));
}

main();
