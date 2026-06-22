#!/usr/bin/env node
/**
 * 新浪财经美股行情获取器
 * 用途：免费获取美股个股、指数、外盘期货行情
 * 数据源：新浪财经 hq.sinajs.cn（无需 API Key，大陆网络可达）
 * 编码：GB2312，需用 TextDecoder('gb2312') 解码
 */

const API_BASE = 'https://hq.sinajs.cn';

const INDEX_SYMBOLS = ['gb_ixic', 'gb_dji', 'gb_inx'];
const STOCK_SYMBOLS = [
  'gb_aapl', 'gb_sndk', 'gb_glw', 'gb_intc', 'gb_smci', 'gb_acn', 'gb_ctsh', 'gb_kr', 'gb_stld',
  'gb_tsla', 'gb_nvda', 'gb_msft', 'gb_amzn', 'gb_googl', 'gb_meta', 'gb_nflx', 'gb_amd',
  'gb_baba', 'gb_jd', 'gb_xom', 'gb_jpm', 'gb_bac', 'gb_wmt',
];
const FUTURES_SYMBOLS = ['hf_CL', 'hf_OIL', 'hf_NQ', 'hf_ES'];

function sinaSymbol(symbol) {
  return symbol.toLowerCase().replace(/\^/g, '');
}

async function fetchSina(symbols) {
  const list = symbols.map(sinaSymbol).join(',');
  const url = `${API_BASE}/list=${list}`;
  const res = await fetch(url, {
    headers: {
      Referer: 'https://finance.sina.com.cn',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const buffer = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder('gb2312').decode(buffer);
  return text;
}

function parseLine(line) {
  const m = line.match(/var\s+hq_str_(\w+)="([^"]*)"/);
  if (!m) return null;
  const [, key, raw] = m;
  if (!raw) return { key, ok: false, error: 'empty response' };
  const fields = raw.split(',');
  return { key, ok: true, fields };
}

function mapStock(key, f) {
  return {
    symbol: key.replace(/^gb_/, '').toUpperCase(),
    name: f[0] || null,
    price: parseFloat(f[1]) || null,
    changePercent: parseFloat(f[2]) || null,
    updatedAt: f[3] || null,
    change: parseFloat(f[4]) || null,
    open: parseFloat(f[5]) || null,
    high: parseFloat(f[6]) || null,
    low: parseFloat(f[7]) || null,
    week52High: parseFloat(f[8]) || null,
    week52Low: parseFloat(f[9]) || null,
    volume: parseFloat(f[10]) || null,
    marketCap: parseFloat(f[12]) || null,
    prevClose: parseFloat(f[26]) || null,
  };
}

function mapFutures(key, f) {
  const prevClose = parseFloat(f[7]) || null;
  const price = parseFloat(f[0]) || null;
  return {
    symbol: key.toUpperCase(),
    name: f[13] || null,
    price,
    open: parseFloat(f[8]) || null,
    high: parseFloat(f[4]) || null,
    low: parseFloat(f[5]) || null,
    prevClose,
    change: price && prevClose ? +(price - prevClose).toFixed(4) : null,
    changePercent: price && prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : null,
    time: f[6] || null,
    date: f[12] || null,
  };
}

export async function fetchQuotes(symbols) {
  const text = await fetchSina(symbols);
  const lines = text.split(';').map(s => s.trim()).filter(Boolean);
  const results = [];
  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { key, ok, fields, error } = parsed;
    if (!ok) {
      results.push({ symbol: key, ok: false, error });
      continue;
    }
    const isFutures = key.startsWith('hf_');
    const mapped = isFutures ? mapFutures(key, fields) : mapStock(key, fields);
    results.push({ ok: true, ...mapped });
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const symbols = args.length > 0 ? args : [...INDEX_SYMBOLS, ...STOCK_SYMBOLS, ...FUTURES_SYMBOLS];
  console.error(`Fetching ${symbols.length} symbols from Sina Finance...`);
  const results = await fetchQuotes(symbols);
  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.error(`\nFailed: ${failed.map(f => f.symbol).join(', ')}`);
    process.exit(1);
  }
}

import { pathToFileURL } from 'node:url';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
