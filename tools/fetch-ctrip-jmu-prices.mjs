#!/usr/bin/env node
/**
 * 携程移动版 H5 佳木斯进港机票价格抓取器
 * 用途：按日期循环查询近 15 天从国内主要城市飞往佳木斯（JMU）的最低票价
 * 数据源：m.ctrip.com/html5/flight/{出发城市码}-JMU-day-{offset}.html
 * 输出：reports/jiamusi_flight_prices_{date}.csv、同名的原始 JSON
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPORTS_DIR = join(__dirname, '..', 'reports');
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

// 出发城市：使用携程城市码（与航线清单对应，BJS/SHA 已聚合多机场）
const ALL_ROUTES = [
  { code: 'BJS', name: '北京' },
  { code: 'SHA', name: '上海' },
  { code: 'CAN', name: '广州' },
  { code: 'SZX', name: '深圳' },
  { code: 'DLC', name: '大连' },
  { code: 'TAO', name: '青岛' },
  { code: 'YNT', name: '烟台' },
  { code: 'TNA', name: '济南' },
  { code: 'HGH', name: '杭州' },
  { code: 'NKG', name: '南京' },
  { code: 'WEH', name: '威海' },
];

const DESTINATION_CODE = 'JMU';
const DESTINATION_NAME = '佳木斯';

// 支持通过环境变量限定抓取的出发城市与天数，默认保持原有行为
const ORIGIN_FILTER = process.env.JMU_ORIGIN_CODES
  ? process.env.JMU_ORIGIN_CODES.split(',').map((s) => s.trim().toUpperCase())
  : null;
const ROUTES = ORIGIN_FILTER
  ? ALL_ROUTES.filter((r) => ORIGIN_FILTER.includes(r.code))
  : ALL_ROUTES;

const DAY_COUNT = Math.max(1, Math.min(30, Number(process.env.JMU_DAY_COUNT || 15)));
const DAY_OFFSETS = Array.from({ length: DAY_COUNT }, (_, i) => i); // day-0 ~ day-(DAY_COUNT-1)
const SLEEP_MS = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractInitialState(html) {
  const marker = 'window.__INITIAL_STATE__=';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length;
  if (html[i] !== '{') return null;
  let depth = 1;
  let inString = false;
  let escape = false;
  i++;
  while (i < html.length && depth > 0) {
    const c = html[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
    } else {
      if (c === '"') {
        inString = true;
      } else if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
      }
    }
    i++;
  }
  return html.slice(start + marker.length, i);
}

async function fetchRouteDay(routeCode, offset, retries = 1) {
  const url = `https://m.ctrip.com/html5/flight/${routeCode}-${DESTINATION_CODE}-day-${offset}.html`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const json = extractInitialState(html);
      if (!json) throw new Error('window.__INITIAL_STATE__ not found');
      const data = JSON.parse(json);
      const list = data.listData;
      if (!list) throw new Error('listData missing');
      return { ok: true, url, list };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(2000);
    }
  }
  return { ok: false, url, error: lastErr?.message || 'unknown' };
}

function summarizeFlights(list) {
  const flights = list.flights || [];
  if (flights.length === 0) {
    return { lowestPrice: null, cheapestAirlines: [], flightCount: 0 };
  }
  const priced = flights
    .map((item) => {
      const flightItem = item.flightItem || item;
      const legs = flightItem.flights || [];
      const firstLeg = legs[0] || {};
      const airline = firstLeg.airline?.name || item.airlineCode || '未知航司';
      const price = item.policy?.price ?? item.price ?? null;
      return { airline, price };
    })
    .filter((x) => typeof x.price === 'number');
  if (priced.length === 0) {
    return { lowestPrice: null, cheapestAirlines: [], flightCount: flights.length };
  }
  const minPrice = Math.min(...priced.map((x) => x.price));
  const cheapestAirlines = [
    ...new Set(priced.filter((x) => x.price === minPrice).map((x) => x.airline)),
  ];
  return {
    lowestPrice: minPrice,
    cheapestAirlines,
    flightCount: flights.length,
  };
}

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const rawByRouteDate = {};
  const rows = [];

  for (const route of ROUTES) {
    console.error(`Fetching ${route.name}(${route.code}) → ${DESTINATION_NAME}`);
    for (const offset of DAY_OFFSETS) {
      const result = await fetchRouteDay(route.code, offset);
      if (!result.ok) {
        console.error(`  day+${offset} failed: ${result.error}`);
        continue;
      }
      const list = result.list;
      const date = list.ddate;
      const summary = summarizeFlights(list);
      const key = `${route.code}_${date}`;
      rawByRouteDate[key] = {
        routeCode: route.code,
        routeName: route.name,
        date,
        sourceUrl: result.url,
        listData: list,
      };
      rows.push({
        date,
        origin: route.name,
        originCode: route.code,
        destination: DESTINATION_NAME,
        destinationCode: DESTINATION_CODE,
        lowestPrice: summary.lowestPrice,
        cheapestAirlines: summary.cheapestAirlines.join(' / ') || '',
        flightCount: summary.flightCount,
        sourceUrl: result.url,
      });
      await sleep(SLEEP_MS);
    }
  }

  if (rows.length === 0) {
    console.error('No data fetched.');
    process.exit(1);
  }

  // 按日期、出发地排序
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.originCode.localeCompare(b.originCode);
  });

  const today = rows[0].date;
  const basename = `jiamusi_flight_prices_${today.replace(/-/g, '')}`;
  const jsonPath = join(REPORTS_DIR, `${basename}.json`);
  const csvPath = join(REPORTS_DIR, `${basename}.csv`);

  const report = {
    meta: {
      generatedAt,
      source: 'Ctrip Mobile H5 (m.ctrip.com/html5/flight)',
      destination: DESTINATION_NAME,
      destinationCode: DESTINATION_CODE,
      dateRangeStart: rows[0].date,
      dateRangeEnd: rows[rows.length - 1].date,
      totalRows: rows.length,
      routes: ROUTES.map((r) => r.code),
    },
    prices: rows,
    raw: rawByRouteDate,
  };

  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const csvHeader = [
    'date',
    'origin',
    'origin_code',
    'destination',
    'destination_code',
    'lowest_price_cny',
    'cheapest_airline',
    'flight_count',
    'source_url',
  ];
  const csvLines = [
    csvHeader.join(','),
    ...rows.map((r) =>
      [
        r.date,
        csvEscape(r.origin),
        r.originCode,
        csvEscape(r.destination),
        r.destinationCode,
        r.lowestPrice == null ? '' : r.lowestPrice,
        csvEscape(r.cheapestAirlines),
        r.flightCount,
        r.sourceUrl,
      ].join(',')
    ),
  ];
  writeFileSync(csvPath, csvLines.join('\n'), 'utf8');

  // 自检：每天是否不少于 3 条航线有价格
  const dateMap = new Map();
  for (const r of rows) {
    if (r.lowestPrice != null) {
      dateMap.set(r.date, (dateMap.get(r.date) || 0) + 1);
    }
  }
  const minRoutesPerDay = Math.min(...dateMap.values());
  const allMeet = minRoutesPerDay >= 3;

  console.log(JSON.stringify({
    jsonPath,
    csvPath,
    totalRows: rows.length,
    minRoutesPerDayWithPrice: minRoutesPerDay,
    meetsAcceptance: allMeet,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
