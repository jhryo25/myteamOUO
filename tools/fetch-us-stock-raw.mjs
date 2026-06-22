#!/usr/bin/env node
/**
 * 获取每日美股原始数据（行情 + 新闻）
 * 输入：无（自动构造日期与标的）
 * 输出：reports/us_stock_raw_<YYYYMMDD>.json
 *       reports/us_stock_indices_<YYYYMMDD>.json
 *       reports/us_stock_focus_<YYYYMMDD>.json
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchQuotes } from './fetch-sina-us-stock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const INDEX_SYMBOLS = ['gb_ixic', 'gb_dji', 'gb_inx'];
const STOCK_SYMBOLS = [
  'gb_aapl', 'gb_sndk', 'gb_glw', 'gb_intc', 'gb_smci', 'gb_acn', 'gb_ctsh', 'gb_kr', 'gb_stld',
  'gb_tsla', 'gb_nvda', 'gb_msft', 'gb_amzn', 'gb_googl', 'gb_meta', 'gb_nflx', 'gb_amd',
  'gb_baba', 'gb_jd', 'gb_xom', 'gb_jpm', 'gb_bac', 'gb_wmt',
];

function getDateString(d = new Date()) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function getIsoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function fetchSinaNews(num = 10) {
  const r = Math.random();
  const url = `https://feed.sina.com.cn/api/roll/get?pageid=153&lid=2516&k=&num=${num}&page=1&r=${r}`;
  const res = await fetch(url, {
    headers: {
      Referer: 'https://finance.sina.com.cn',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  if (!res.ok) throw new Error(`News HTTP ${res.status} from ${url}`);
  const data = await res.json();
  if (!data?.result?.data) throw new Error('Unexpected news response structure');
  return data.result.data;
}

function mapNewsItem(item) {
  return {
    title: item.title || '',
    intro: item.intro || '',
    url: item.url || '',
    wapUrl: item.wapurl || '',
    mediaName: item.media_name || '',
    ctime: item.ctime || '',
    intime: item.intime || '',
    docid: item.docid || '',
  };
}

async function main() {
  const today = process.argv[2] || getDateString();
  const basedOn = process.argv[3] || getIsoDate();

  console.error(`Fetching ${INDEX_SYMBOLS.length} indices and ${STOCK_SYMBOLS.length} stocks from Sina Finance...`);
  const quotes = await fetchQuotes([...INDEX_SYMBOLS, ...STOCK_SYMBOLS]);

  const failed = quotes.filter(q => !q.ok);
  if (failed.length) {
    console.error(`\nFailed quotes: ${failed.map(f => f.symbol).join(', ')}`);
    process.exitCode = 1;
  }

  const indices = quotes.filter(q => INDEX_SYMBOLS.includes(`gb_${q.symbol.toLowerCase()}`));
  const focus = quotes.filter(q => STOCK_SYMBOLS.includes(`gb_${q.symbol.toLowerCase()}`));

  console.error(`Fetching Sina Finance news...`);
  const newsItems = await fetchSinaNews(10);
  const news = newsItems.map(mapNewsItem);

  const raw = {
    date: today,
    basedOn,
    generatedAt: new Date().toISOString(),
    source: 'Sina Finance',
    indices,
    focus,
    news,
  };

  const rawPath = join(ROOT, 'reports', `us_stock_raw_${today}.json`);
  writeFileSync(rawPath, JSON.stringify(raw, null, 2));
  console.log(`原始数据已保存: ${rawPath}`);

  const indicesPath = join(ROOT, 'reports', `us_stock_indices_${today}.json`);
  const focusPath = join(ROOT, 'reports', `us_stock_focus_${today}.json`);
  writeFileSync(indicesPath, JSON.stringify(indices, null, 2));
  writeFileSync(focusPath, JSON.stringify({ quotes: focus }, null, 2));
  console.log(`指数数据已保存: ${indicesPath}`);
  console.log(`个股数据已保存: ${focusPath}`);
  console.log(`新闻条数: ${news.length}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
