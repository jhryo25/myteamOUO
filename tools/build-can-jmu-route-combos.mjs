#!/usr/bin/env node
/**
 * 广州(CAN) → 佳木斯(JMU) 有效航线组合生成器
 * 用途：从携程价格原始数据中提取 CAN→JMU 的实际航班组合（直飞/一次中转）
 * 输出：reports/can_jmu_route_combos_{date}.json、同名 CSV
 *
 * 输入来源：reports/jiamusi_flight_prices_YYYYMMDD.json（由 fetch-ctrip-jmu-prices.mjs 生成）
 * 说明：本工具只做航线组合识别，价格字段由下游价格匹配步骤使用。
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORTS_DIR = join(__dirname, '..', 'reports');

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function findLatestPriceRaw() {
  const override = process.env.CAN_JMU_PRICE_RAW;
  if (override) return override;
  const files = readdirSync(REPORTS_DIR)
    .filter((f) => /^jiamusi_flight_prices_\d{8}\.json$/.test(f))
    .sort();
  if (files.length === 0) throw new Error('No jiamusi_flight_prices_*.json found in reports/');
  return join(REPORTS_DIR, files[files.length - 1]);
}

function loadPriceRaw(path) {
  const content = readFileSync(path, 'utf8');
  return JSON.parse(content);
}

function isValidCanJmuOption(flightItem) {
  const legs = flightItem.flights || [];
  if (legs.length === 0) return false;
  const firstLeg = legs[0];
  const lastLeg = legs[legs.length - 1];
  return firstLeg.dport?.code === 'CAN' && lastLeg.aport?.code === 'JMU';
}

function buildSegment(leg, sequence) {
  return {
    sequence,
    flight_no: leg.flightNo || '',
    airline_code: leg.airline?.code || '',
    airline_name: leg.airline?.name || '',
    dep_airport_iata: leg.dport?.code || '',
    dep_airport_name: leg.dport?.fullName || '',
    dep_city: leg.dport?.cityName || '',
    dep_terminal: leg.dport?.terminal || '',
    arr_airport_iata: leg.aport?.code || '',
    arr_airport_name: leg.aport?.fullName || '',
    arr_city: leg.aport?.cityName || '',
    arr_terminal: leg.aport?.terminal || '',
    dep_time: leg.dtime || '',
    arr_time: leg.atime || '',
    duration_min: typeof leg.duration === 'number' ? leg.duration : null,
  };
}

export function extractCanJmuCombos(priceRaw) {
  const rawByKey = priceRaw?.raw || {};
  const keys = Object.keys(rawByKey)
    .filter((k) => k.startsWith('CAN_'))
    .sort();

  const combos = [];

  for (const key of keys) {
    const date = key.split('_')[1];
    const entry = rawByKey[key];
    const list = entry?.listData || {};
    const flights = list.flights || [];
    const seen = new Set();

    for (const item of flights) {
      const flightItem = item.flightItem || item;
      if (!isValidCanJmuOption(flightItem)) continue;

      const legs = flightItem.flights;
      const firstLeg = legs[0];
      const lastLeg = legs[legs.length - 1];
      const segmentType = legs.length === 1 ? '直飞' : '一次中转';
      const transferCity = legs.length > 1 ? legs[0].aport?.cityName || '' : '';
      const transferAirportIata = legs.length > 1 ? legs[0].aport?.code || '' : '';

      const segments = legs.map((leg, idx) => buildSegment(leg, idx + 1));

      const dedupeKey = [date, ...segments.map((s) => `${s.flight_no}|${s.dep_time}`)].join('::');
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const dateCombos = combos.filter((c) => c.date === date);
      combos.push({
        option_id: `CAN-JMU-${date}-${String(dateCombos.length + 1).padStart(3, '0')}`,
        date,
        origin_city: firstLeg.dport?.cityName || '',
        origin_airport_iata: firstLeg.dport?.code || '',
        destination_city: lastLeg.aport?.cityName || '',
        destination_airport_iata: lastLeg.aport?.code || '',
        segment_type: segmentType,
        transfer_city: transferCity,
        transfer_airport_iata: transferAirportIata,
        total_segments: legs.length,
        total_duration_min: typeof flightItem.duration === 'number' ? flightItem.duration : null,
        source_url: entry.sourceUrl || '',
        segments,
      });
    }
  }

  return combos;
}

export function buildComboReport(combos, sourcePath) {
  const generatedAt = new Date().toISOString();
  const directCount = combos.filter((c) => c.segment_type === '直飞').length;
  const transitCount = combos.filter((c) => c.segment_type === '一次中转').length;
  const dates = [...new Set(combos.map((c) => c.date))].sort();

  return {
    meta: {
      generated_at: generatedAt,
      source_raw: sourcePath,
      origin: '广州',
      origin_code: 'CAN',
      destination: '佳木斯',
      destination_code: 'JMU',
      date_range_start: dates[0] || '',
      date_range_end: dates[dates.length - 1] || '',
      total_options: combos.length,
      direct_options: directCount,
      transit_options: transitCount,
      note: '航线组合基于携程 H5 实时搜索结果；航班号、起降机场、日期、航程类型已提取，价格由下游步骤匹配。',
    },
    combos,
  };
}

export function buildComboCsv(report) {
  const header = [
    'option_id',
    'date',
    'origin_city',
    'origin_airport_iata',
    'destination_city',
    'destination_airport_iata',
    'segment_type',
    'transfer_city',
    'transfer_airport_iata',
    'total_segments',
    'total_duration_min',
    'source_url',
    'segment_sequence',
    'flight_no',
    'airline_code',
    'airline_name',
    'dep_airport_iata',
    'dep_airport_name',
    'dep_city',
    'dep_terminal',
    'arr_airport_iata',
    'arr_airport_name',
    'arr_city',
    'arr_terminal',
    'dep_time',
    'arr_time',
    'segment_duration_min',
  ];
  const lines = [header.join(',')];
  for (const combo of report.combos) {
    for (const seg of combo.segments) {
      lines.push(
        [
          csvEscape(combo.option_id),
          csvEscape(combo.date),
          csvEscape(combo.origin_city),
          csvEscape(combo.origin_airport_iata),
          csvEscape(combo.destination_city),
          csvEscape(combo.destination_airport_iata),
          csvEscape(combo.segment_type),
          csvEscape(combo.transfer_city),
          csvEscape(combo.transfer_airport_iata),
          csvEscape(combo.total_segments),
          csvEscape(combo.total_duration_min),
          csvEscape(combo.source_url),
          csvEscape(seg.sequence),
          csvEscape(seg.flight_no),
          csvEscape(seg.airline_code),
          csvEscape(seg.airline_name),
          csvEscape(seg.dep_airport_iata),
          csvEscape(seg.dep_airport_name),
          csvEscape(seg.dep_city),
          csvEscape(seg.dep_terminal),
          csvEscape(seg.arr_airport_iata),
          csvEscape(seg.arr_airport_name),
          csvEscape(seg.arr_city),
          csvEscape(seg.arr_terminal),
          csvEscape(seg.dep_time),
          csvEscape(seg.arr_time),
          csvEscape(seg.duration_min),
        ].join(',')
      );
    }
  }
  return lines.join('\n');
}

function main() {
  const sourcePath = findLatestPriceRaw();
  const priceRaw = loadPriceRaw(sourcePath);
  const combos = extractCanJmuCombos(priceRaw);

  if (combos.length === 0) {
    console.error('No CAN→JMU route combos found in raw price data.');
    process.exit(1);
  }

  const report = buildComboReport(combos, sourcePath);
  const endDate = report.meta.date_range_end.replace(/-/g, '');
  const basename = `can_jmu_route_combos_${endDate}`;
  const jsonPath = join(REPORTS_DIR, `${basename}.json`);
  const csvPath = join(REPORTS_DIR, `${basename}.csv`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(csvPath, buildComboCsv(report), 'utf8');

  console.log(
    JSON.stringify(
      {
        jsonPath,
        csvPath,
        sourceRaw: sourcePath,
        totalOptions: report.meta.total_options,
        directOptions: report.meta.direct_options,
        transitOptions: report.meta.transit_options,
        dateRangeStart: report.meta.date_range_start,
        dateRangeEnd: report.meta.date_range_end,
        meetsAcceptance: report.meta.total_options >= 1 && combos.every((c) => c.segments.length > 0),
      },
      null,
      2
    )
  );
}

main();
