#!/usr/bin/env node
/**
 * 校验 jiamusi_flight_prices_*.json / clean_data.json 是否符合验收标准：
 *
 * 原始数据模式（默认）：
 *   - 近 15 天每天至少 3 条航线有最低票价
 *   - 字段包含 date/origin/destination/lowest_price/cheapest_airline
 *
 * 清洗数据模式（--clean）：
 *   - 按 date + originCode 无重复记录
 *   - 关键字段完整率 100%
 *   - 异常价格已标记或剔除（价格为 null 时 hasFlight=false；
 *     非空价格为非负整数且 avgPrice >= lowestPrice；折扣率在 [0,1] 或为 null）
 *   - 日期覆盖预期范围（默认 2026-06-21 ~ 2026-06-27，共 7 天）
 */

import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORTS_DIR = join(__dirname, '..', 'reports');

const EXPECTED_DAYS = 7;
const EXPECTED_DATE_START = '2026-06-21';
const EXPECTED_DATE_END = '2026-06-27';

export const REQUIRED_RAW_FIELDS = [
  'date',
  'origin',
  'destination',
  'lowestPrice',
  'cheapestAirlines',
];

export const REQUIRED_CLEAN_FIELDS = [
  'date',
  'origin',
  'originCode',
  'destination',
  'destinationCode',
  'routeId',
  'lowestPrice',
  'avgPrice',
  'cheapestAirlines',
  'flightCount',
  'hasFlight',
  'discountRate',
  'sourceUrl',
];

function findLatestReport() {
  const files = globSync('jiamusi_flight_prices_*.json', { cwd: REPORTS_DIR });
  if (files.length === 0) return null;
  files.sort();
  return join(REPORTS_DIR, files[files.length - 1]);
}

function findLatestCleanData() {
  const files = globSync('jiamusi_flight_clean_data_*.json', { cwd: REPORTS_DIR });
  if (files.length === 0) return null;
  files.sort();
  return join(REPORTS_DIR, files[files.length - 1]);
}

export function verifyRawReport(report) {
  const rows = report.prices || [];

  if (rows.length === 0) {
    return {
      ok: false,
      errors: ['原始报告 prices 为空'],
      totalRows: 0,
      days: 0,
      minRoutesPerDayWithPrice: 0,
    };
  }

  const missingFields = REQUIRED_RAW_FIELDS.filter((f) => !(f in rows[0]));
  if (missingFields.length > 0) {
    return {
      ok: false,
      errors: [`原始报告缺少字段: ${missingFields.join(', ')}`],
      totalRows: rows.length,
      days: 0,
      minRoutesPerDayWithPrice: 0,
    };
  }

  const byDate = new Map();
  for (const r of rows) {
    if (r.lowestPrice != null) {
      byDate.set(r.date, (byDate.get(r.date) || 0) + 1);
    }
  }
  const minRoutes = byDate.size > 0 ? Math.min(...byDate.values()) : 0;
  const ok = minRoutes >= 3;

  return {
    ok,
    errors: ok ? [] : [`每天至少 3 条航线有最低票价的要求未满足（实际最小值: ${minRoutes}）`],
    totalRows: rows.length,
    days: byDate.size,
    minRoutesPerDayWithPrice: minRoutes,
  };
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

export function verifyCleanData(cleaned) {
  const rows = cleaned?.prices || [];
  const errors = [];

  // 1. 字段完整率 100%
  const incomplete = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const missing = REQUIRED_CLEAN_FIELDS.filter((f) => !(f in row));
    if (missing.length > 0) {
      incomplete.push({ index: i, missing });
    }
  }
  if (incomplete.length > 0) {
    errors.push(
      `字段不完整记录 ${incomplete.length} 条: ${incomplete
        .slice(0, 3)
        .map((x) => `[${x.index}] 缺 ${x.missing.join(', ')}`)
        .join('; ')}`
    );
  }

  // 2. 无重复记录（按 date + originCode）
  const seen = new Map();
  const duplicates = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = `${row.date}|${row.originCode}`;
    if (seen.has(key)) {
      duplicates.push({ key, indices: [seen.get(key), i] });
    } else {
      seen.set(key, i);
    }
  }
  if (duplicates.length > 0) {
    errors.push(
      `发现重复记录 ${duplicates.length} 组: ${duplicates
        .slice(0, 3)
        .map((d) => d.key)
        .join(', ')}`
    );
  }

  // 3. 异常价格标记/剔除
  const anomalies = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.hasFlight) {
      // 无航班时价格应为 null
      if (row.lowestPrice != null || row.avgPrice != null) {
        anomalies.push({ index: i, reason: 'hasFlight=false 但价格非空' });
      }
      continue;
    }

    if (row.lowestPrice == null || row.avgPrice == null) {
      anomalies.push({ index: i, reason: 'hasFlight=true 但价格缺失' });
      continue;
    }

    if (!isNonNegativeInteger(row.lowestPrice)) {
      anomalies.push({ index: i, reason: `lowestPrice 不是非负整数: ${row.lowestPrice}` });
    }
    if (!isNonNegativeInteger(row.avgPrice)) {
      anomalies.push({ index: i, reason: `avgPrice 不是非负整数: ${row.avgPrice}` });
    }
    if (row.avgPrice < row.lowestPrice) {
      anomalies.push({
        index: i,
        reason: `avgPrice(${row.avgPrice}) < lowestPrice(${row.lowestPrice})`,
      });
    }
    if (row.discountRate != null && (row.discountRate < 0 || row.discountRate > 1)) {
      anomalies.push({
        index: i,
        reason: `discountRate 超出 [0,1]: ${row.discountRate}`,
      });
    }
  }
  if (anomalies.length > 0) {
    errors.push(
      `异常价格记录 ${anomalies.length} 条: ${anomalies
        .slice(0, 3)
        .map((a) => `[${a.index}] ${a.reason}`)
        .join('; ')}`
    );
  }

  // 4. 日期覆盖预期 7 天
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const expectedDates = [];
  const start = new Date(EXPECTED_DATE_START);
  const end = new Date(EXPECTED_DATE_END);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    expectedDates.push(d.toISOString().slice(0, 10));
  }
  const missingDates = expectedDates.filter((d) => !dates.includes(d));
  if (missingDates.length > 0) {
    errors.push(`缺少预期日期: ${missingDates.join(', ')}`);
  }
  if (dates.length !== EXPECTED_DAYS) {
    errors.push(`日期数量不符: 期望 ${EXPECTED_DAYS} 天, 实际 ${dates.length} 天`);
  }

  return {
    ok: errors.length === 0,
    errors,
    totalRows: rows.length,
    days: dates.length,
    duplicates: duplicates.length,
    anomalies: anomalies.length,
    incomplete: incomplete.length,
    expectedDates,
    actualDates: dates,
  };
}

export function main(options = {}) {
  const cleanMode = options.clean || process.argv.includes('--clean');

  if (cleanMode) {
    const path = options.cleanPath || findLatestCleanData() || join(REPORTS_DIR, 'clean_data.json');
    const cleaned = JSON.parse(readFileSync(path, 'utf8'));
    const result = verifyCleanData(cleaned);

    const output = {
      mode: 'clean',
      report: path,
      ...result,
    };
    if (options.silent) return output;
    console.log(JSON.stringify(output, null, 2));
    return output;
  }

  const path = options.path || findLatestReport();
  if (!path) {
    const err = { ok: false, errors: ['No jiamusi_flight_prices_*.json report found.'] };
    if (options.silent) return err;
    console.error(JSON.stringify(err, null, 2));
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const result = verifyRawReport(report);

  const output = {
    mode: 'raw',
    report: path,
    ...result,
  };
  if (options.silent) return output;
  console.log(JSON.stringify(output, null, 2));
  if (!result.ok) process.exit(1);
  return output;
}

const isMain =
  process.argv[1] &&
  import.meta.url ===
    new URL('verify-jmu-prices.mjs', 'file://' + process.argv[1].replace(/\\/g, '/')).href;
if (isMain) {
  main();
}
