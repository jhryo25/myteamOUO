#!/usr/bin/env node
/**
 * 佳木斯进港机票数据清洗与结构化
 * 输入：reports/jiamusi_flight_prices_*.json（fetch-ctrip-jmu-prices.mjs 输出）
 * 输出：
 *   - reports/jiamusi_flight_clean_data_{YYYYMMDD}.json
 *   - reports/jiamusi_flight_clean_data_{YYYYMMDD}.csv
 *   - reports/clean_data.json（最新副本，供下游 HTML 生成直接读取）
 *
 * 清洗规则：
 *   1. 按 date + originCode 去重；若重复项中存在非空价格，优先保留非空项。
 *   2. 缺失价格/航班为空时，lowestPrice/avgPrice 置 null，hasFlight=false，不补全。
 *   3. 价格统一为整数 CNY；航司名统一为官方简称。
 *   4. 从原始 listData 重新计算每航线每日的均价、折扣率（取最低 policy.rate）。
 *   5. 汇总每日/每条航线/全局统计指标。
 */

import { readFileSync, writeFileSync, globSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORTS_DIR = join(__dirname, '..', 'reports');

// 航司名标准化：把抓取端可能出现的简写/海航系前缀统一为官方简称
export const AIRLINE_NAME_MAP = {
  '东方航空': '中国东方航空',
  '中国国航': '中国国际航空',
  '南方航空': '中国南方航空',
  '厦门航空': '厦门航空',
  '深圳航空': '深圳航空',
  '四川航空': '四川航空',
  '山东航空': '山东航空',
  '春秋航空': '春秋航空',
  '吉祥航空': '吉祥航空',
  '海南航空': '海南航空',
  '首都航空': '首都航空',
  '天津航空': '天津航空',
  '西部航空': '西部航空',
  '金鹏航空': '金鹏航空',
  '上海航空': '上海航空',
  '中国联合航空': '中国联合航空',
  '东海航空': '东海航空',
  '青岛航空': '青岛航空',
  '成都航空': '成都航空',
  '华夏航空': '华夏航空',
  '河北航空': '河北航空',
  '长龙航空': '长龙航空',
  '西藏航空': '西藏航空',
  '龙江航空': '龙江航空',
  '九元航空': '九元航空',
};

export function normalizeAirlineName(raw) {
  if (!raw || typeof raw !== 'string') return '未知航司';
  // 处理海航系前缀，如 "新海航｜海南航空" -> "海南航空"
  let name = raw.includes('｜') ? raw.split('｜').pop().trim() : raw.trim();
  // 处理常见简写
  return AIRLINE_NAME_MAP[name] || name;
}

function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
}

/**
 * 从单个 listData 提取：
 *   - lowestPrice: 所有航班最低价
 *   - avgPrice: 所有航班平均价
 *   - cheapestAirlines: 取得最低价的航司列表（已标准化，去重）
 *   - flightCount: 航班条数
 *   - discountRate: 最低 policy.rate（CTrip 提供的相对全价折扣率）
 */
export function extractFlightStats(listData) {
  const flights = listData?.flights || [];
  const priced = [];
  for (const f of flights) {
    const price = parsePrice(f?.policy?.price ?? f?.price);
    if (price === null) continue;
    const flightItem = f?.flightItem || f;
    const leg = flightItem?.flights?.[0] || {};
    const airlineRaw = leg?.airline?.name || f?.airlineCode || '未知航司';
    const rate = typeof f?.policy?.rate === 'number' ? f.policy.rate : null;
    priced.push({ price, airline: normalizeAirlineName(airlineRaw), rate });
  }

  if (priced.length === 0) {
    return {
      lowestPrice: null,
      avgPrice: null,
      cheapestAirlines: [],
      flightCount: flights.length,
      discountRate: null,
    };
  }

  const total = priced.reduce((sum, p) => sum + p.price, 0);
  const avgPrice = Math.round(total / priced.length);
  const lowestPrice = Math.min(...priced.map((p) => p.price));
  const cheapestSet = new Set(
    priced.filter((p) => p.price === lowestPrice).map((p) => p.airline)
  );
  const discountRate = Math.min(
    ...priced.filter((p) => p.rate !== null).map((p) => p.rate)
  );

  return {
    lowestPrice,
    avgPrice,
    cheapestAirlines: [...cheapestSet],
    flightCount: flights.length,
    discountRate: Number.isFinite(discountRate) ? discountRate : null,
  };
}

function round2(num) {
  return Math.round(num * 100) / 100;
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * 核心清洗函数
 */
export function cleanPrices({ meta, prices, raw }) {
  // 1. 去重：按 date + originCode，优先保留有价格的记录
  const dedup = new Map();
  for (const row of prices || []) {
    const key = `${row.date}|${row.originCode}`;
    const existing = dedup.get(key);
    const keep =
      !existing ||
      (existing.lowestPrice == null && row.lowestPrice != null) ||
      (existing.lowestPrice != null &&
        row.lowestPrice != null &&
        row.lowestPrice < existing.lowestPrice);
    if (keep) dedup.set(key, row);
  }

  // 2. 逐条清洗，优先从 raw 重新计算航司/均价/折扣率
  const cleaned = [];
  for (const row of dedup.values()) {
    const rawKey = `${row.originCode}_${row.date}`;
    const rawEntry = raw?.[rawKey];
    const stats = rawEntry?.listData
      ? extractFlightStats(rawEntry.listData)
      : null;

    const hasFlight =
      row.flightCount > 0 &&
      (stats?.lowestPrice != null || row.lowestPrice != null);

    const cheapestAirlines =
      stats?.cheapestAirlines?.length
        ? stats.cheapestAirlines
        : hasFlight
          ? String(row.cheapestAirlines || '')
              .split(/\s*\/\s*/)
              .map(normalizeAirlineName)
              .filter(Boolean)
          : [];

    cleaned.push({
      date: row.date,
      origin: row.origin,
      originCode: row.originCode,
      destination: row.destination,
      destinationCode: row.destinationCode,
      routeId: `${row.originCode}-${row.destinationCode}`,
      lowestPrice: stats?.lowestPrice ?? row.lowestPrice ?? null,
      avgPrice: stats?.avgPrice ?? null,
      cheapestAirlines,
      cheapestAirlineText: cheapestAirlines.join(' / ') || '',
      flightCount: row.flightCount ?? 0,
      hasFlight,
      discountRate: stats?.discountRate ?? null,
      sourceUrl: row.sourceUrl || '',
    });
  }

  cleaned.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.originCode.localeCompare(b.originCode);
  });

  // 3. 按日期汇总
  const byDate = new Map();
  for (const r of cleaned) {
    let d = byDate.get(r.date);
    if (!d) {
      d = {
        date: r.date,
        routeCount: 0,
        routesWithPrice: 0,
        lowestPrices: [],
        avgPrices: [],
        discountRates: [],
        cheapest: [],
      };
      byDate.set(r.date, d);
    }
    d.routeCount++;
    if (r.hasFlight && r.lowestPrice != null) {
      d.routesWithPrice++;
      d.lowestPrices.push(r.lowestPrice);
      if (r.avgPrice != null) d.avgPrices.push(r.avgPrice);
      if (r.discountRate != null) d.discountRates.push(r.discountRate);
      d.cheapest.push({
        routeId: r.routeId,
        origin: r.origin,
        originCode: r.originCode,
        lowestPrice: r.lowestPrice,
        cheapestAirlines: r.cheapestAirlines,
      });
    }
  }

  const dailySummary = [];
  for (const d of byDate.values()) {
    const dailyLowestPrice = d.lowestPrices.length
      ? Math.min(...d.lowestPrices)
      : null;
    const dailyAvgPrice = d.lowestPrices.length
      ? Math.round(mean(d.lowestPrices))
      : null;
    const dailyAvgFlightPrice = d.avgPrices.length
      ? Math.round(mean(d.avgPrices))
      : null;
    const minDiscountRate = d.discountRates.length
      ? round2(Math.min(...d.discountRates))
      : null;
    const avgDiscountRate = d.discountRates.length
      ? round2(mean(d.discountRates))
      : null;
    const cheapest = d.cheapest.reduce(
      (best, cur) =>
        best == null || cur.lowestPrice < best.lowestPrice ? cur : best,
      null
    );
    dailySummary.push({
      date: d.date,
      routeCount: d.routeCount,
      routesWithPrice: d.routesWithPrice,
      dailyLowestPrice,
      dailyAvgPrice,
      dailyAvgFlightPrice,
      minDiscountRate,
      avgDiscountRate,
      cheapestRoute: cheapest?.routeId || null,
      cheapestRouteOrigin: cheapest?.origin || null,
      cheapestAirlines: cheapest?.cheapestAirlines || [],
    });
  }
  dailySummary.sort((a, b) => a.date.localeCompare(b.date));

  // 4. 按航线汇总
  const byRoute = new Map();
  for (const r of cleaned) {
    let route = byRoute.get(r.routeId);
    if (!route) {
      route = {
        routeId: r.routeId,
        origin: r.origin,
        originCode: r.originCode,
        destination: r.destination,
        destinationCode: r.destinationCode,
        datesWithPrice: 0,
        lowestPrices: [],
        avgPrices: [],
        discountRates: [],
      };
      byRoute.set(r.routeId, route);
    }
    if (r.hasFlight && r.lowestPrice != null) {
      route.datesWithPrice++;
      route.lowestPrices.push(r.lowestPrice);
      if (r.avgPrice != null) route.avgPrices.push(r.avgPrice);
      if (r.discountRate != null) route.discountRates.push(r.discountRate);
    }
  }
  const routeSummary = [];
  for (const r of byRoute.values()) {
    routeSummary.push({
      routeId: r.routeId,
      origin: r.origin,
      originCode: r.originCode,
      destination: r.destination,
      destinationCode: r.destinationCode,
      datesWithPrice: r.datesWithPrice,
      minLowestPrice: r.lowestPrices.length ? Math.min(...r.lowestPrices) : null,
      avgLowestPrice: r.lowestPrices.length ? Math.round(mean(r.lowestPrices)) : null,
      maxLowestPrice: r.lowestPrices.length ? Math.max(...r.lowestPrices) : null,
      avgFlightPrice: r.avgPrices.length ? Math.round(mean(r.avgPrices)) : null,
      avgDiscountRate: r.discountRates.length
        ? round2(mean(r.discountRates))
        : null,
    });
  }
  routeSummary.sort((a, b) => a.routeId.localeCompare(b.routeId));

  // 5. 全局汇总
  const allLowest = cleaned
    .filter((r) => r.hasFlight && r.lowestPrice != null)
    .map((r) => r.lowestPrice);
  const allAvg = cleaned
    .filter((r) => r.hasFlight && r.avgPrice != null)
    .map((r) => r.avgPrice);
  const allRates = cleaned
    .filter((r) => r.hasFlight && r.discountRate != null)
    .map((r) => r.discountRate);
  const missingCombos = cleaned.filter((r) => !r.hasFlight);

  const overallSummary = {
    totalRouteDateCombos: cleaned.length,
    combosWithPrice: allLowest.length,
    missingCombos: missingCombos.length,
    missingCombosList: missingCombos.map((r) => ({
      date: r.date,
      originCode: r.originCode,
      origin: r.origin,
      reason: '无航班或当日无报价',
    })),
    globalLowestPrice: allLowest.length ? Math.min(...allLowest) : null,
    globalAvgLowestPrice: allLowest.length ? Math.round(mean(allLowest)) : null,
    globalAvgFlightPrice: allAvg.length ? Math.round(mean(allAvg)) : null,
    globalMinDiscountRate: allRates.length ? round2(Math.min(...allRates)) : null,
    globalAvgDiscountRate: allRates.length ? round2(mean(allRates)) : null,
  };

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceReport: meta?.source || 'ctrip-mobile-h5',
      sourceReportPath: meta?.path || '',
      destination: meta?.destination || '佳木斯',
      destinationCode: meta?.destinationCode || 'JMU',
      dateRangeStart: meta?.dateRangeStart || cleaned[0]?.date || '',
      dateRangeEnd: meta?.dateRangeEnd || cleaned[cleaned.length - 1]?.date || '',
      totalRows: cleaned.length,
      missingValueHandling: {
        deduplication: '按 date + originCode 去重，价格非空的重复项优先',
        nullPrice: 'lowestPrice/avgPrice 置 null，hasFlight=false，不参与均价/折扣计算，不补全',
        dateImputation: '不补全缺失日期，直接标注为无航班',
        priceFormat: '整数 CNY，四舍五入到元',
        airlineNormalization:
          '统一为官方简称；海航系拆分为实际承运航司；东航/国航/南航补全全称',
      },
    },
    prices: cleaned,
    dailySummary,
    routeSummary,
    overallSummary,
  };
}

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(cleaned) {
  const header = [
    'date',
    'origin',
    'origin_code',
    'destination',
    'destination_code',
    'route_id',
    'lowest_price_cny',
    'avg_price_cny',
    'cheapest_airline',
    'flight_count',
    'has_flight',
    'discount_rate',
    'source_url',
  ];
  const lines = [header.join(',')];
  for (const r of cleaned) {
    lines.push(
      [
        r.date,
        csvEscape(r.origin),
        r.originCode,
        csvEscape(r.destination),
        r.destinationCode,
        r.routeId,
        r.lowestPrice == null ? '' : r.lowestPrice,
        r.avgPrice == null ? '' : r.avgPrice,
        csvEscape(r.cheapestAirlineText),
        r.flightCount,
        r.hasFlight ? 'true' : 'false',
        r.discountRate == null ? '' : r.discountRate,
        r.sourceUrl,
      ].join(',')
    );
  }
  return lines.join('\n');
}

function findLatestReport() {
  const files = globSync('jiamusi_flight_prices_*.json', { cwd: REPORTS_DIR });
  if (files.length === 0) return null;
  files.sort();
  return join(REPORTS_DIR, files[files.length - 1]);
}

export function main(options = {}) {
  const sourcePath = options.sourcePath || findLatestReport();
  if (!sourcePath) {
    throw new Error('No jiamusi_flight_prices_*.json report found in reports/');
  }

  const report = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const cleaned = cleanPrices({
    meta: { ...report.meta, path: sourcePath },
    prices: report.prices,
    raw: report.raw,
  });

  const startDate = cleaned.meta.dateRangeStart || 'unknown';
  const suffix = startDate.replace(/-/g, '');
  const jsonPath = join(REPORTS_DIR, `jiamusi_flight_clean_data_${suffix}.json`);
  const csvPath = join(REPORTS_DIR, `jiamusi_flight_clean_data_${suffix}.csv`);
  const latestPath = join(REPORTS_DIR, 'clean_data.json');

  writeFileSync(jsonPath, JSON.stringify(cleaned, null, 2), 'utf8');
  writeFileSync(csvPath, toCsv(cleaned.prices), 'utf8');
  writeFileSync(latestPath, JSON.stringify(cleaned, null, 2), 'utf8');

  const result = {
    jsonPath,
    csvPath,
    latestPath,
    totalRows: cleaned.prices.length,
    days: cleaned.dailySummary.length,
    routes: cleaned.routeSummary.length,
    combosWithPrice: cleaned.overallSummary.combosWithPrice,
    missingCombos: cleaned.overallSummary.missingCombos,
    globalLowestPrice: cleaned.overallSummary.globalLowestPrice,
    globalAvgLowestPrice: cleaned.overallSummary.globalAvgLowestPrice,
  };

  if (options.silent) return { cleaned, result };
  console.log(JSON.stringify(result, null, 2));
  return { cleaned, result };
}

const isMain = process.argv[1] &&
  import.meta.url === new URL('clean-jmu-prices.mjs', 'file://' + process.argv[1].replace(/\\/g, '/')).href;
if (isMain) {
  main();
}
