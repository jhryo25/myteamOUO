import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyRawReport,
  verifyCleanData,
} from '../tools/verify-jmu-prices.mjs';

test('verifyRawReport passes when enough routes per day have prices', () => {
  const report = {
    prices: [
      { date: '2026-06-21', origin: '广州', destination: '佳木斯', lowestPrice: 900, cheapestAirlines: '航司A' },
      { date: '2026-06-21', origin: '北京', destination: '佳木斯', lowestPrice: 800, cheapestAirlines: '航司B' },
      { date: '2026-06-21', origin: '上海', destination: '佳木斯', lowestPrice: 700, cheapestAirlines: '航司C' },
      { date: '2026-06-22', origin: '广州', destination: '佳木斯', lowestPrice: 850, cheapestAirlines: '航司A' },
      { date: '2026-06-22', origin: '北京', destination: '佳木斯', lowestPrice: 750, cheapestAirlines: '航司B' },
      { date: '2026-06-22', origin: '上海', destination: '佳木斯', lowestPrice: 650, cheapestAirlines: '航司C' },
    ],
  };
  const result = verifyRawReport(report);
  assert.equal(result.ok, true);
  assert.equal(result.totalRows, 6);
  assert.equal(result.days, 2);
  assert.equal(result.minRoutesPerDayWithPrice, 3);
});

test('verifyRawReport fails when too few routes per day have prices', () => {
  const report = {
    prices: [
      { date: '2026-06-21', origin: '广州', destination: '佳木斯', lowestPrice: 900, cheapestAirlines: '航司A' },
    ],
  };
  const result = verifyRawReport(report);
  assert.equal(result.ok, false);
  assert.equal(result.minRoutesPerDayWithPrice, 1);
  assert.ok(result.errors[0].includes('3'));
});

test('verifyRawReport fails when required fields are missing', () => {
  const report = {
    prices: [{ date: '2026-06-21', origin: '广州' }],
  };
  const result = verifyRawReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors[0].includes('缺少字段'));
});

function buildCleanRow(overrides = {}) {
  return {
    date: '2026-06-21',
    origin: '广州',
    originCode: 'CAN',
    destination: '佳木斯',
    destinationCode: 'JMU',
    routeId: 'CAN-JMU',
    lowestPrice: 900,
    avgPrice: 1200,
    cheapestAirlines: ['航司A'],
    cheapestAirlineText: '航司A',
    flightCount: 5,
    hasFlight: true,
    discountRate: 0.3,
    sourceUrl: 'https://example.com',
    ...overrides,
  };
}

test('verifyCleanData passes for valid cleaned data', () => {
  const cleaned = {
    prices: [
      buildCleanRow({ date: '2026-06-21' }),
      buildCleanRow({ date: '2026-06-22', lowestPrice: 800, avgPrice: 1000 }),
      buildCleanRow({ date: '2026-06-23', lowestPrice: 700, avgPrice: 900 }),
      buildCleanRow({ date: '2026-06-24', lowestPrice: 600, avgPrice: 800 }),
      buildCleanRow({ date: '2026-06-25', lowestPrice: 500, avgPrice: 700 }),
      buildCleanRow({ date: '2026-06-26', lowestPrice: 400, avgPrice: 600 }),
      buildCleanRow({ date: '2026-06-27', lowestPrice: 300, avgPrice: 500 }),
    ],
  };
  const result = verifyCleanData(cleaned);
  assert.equal(result.ok, true);
  assert.equal(result.duplicates, 0);
  assert.equal(result.anomalies, 0);
  assert.equal(result.incomplete, 0);
  assert.equal(result.days, 7);
});

test('verifyCleanData detects duplicate date+originCode records', () => {
  const cleaned = {
    prices: [
      buildCleanRow({ date: '2026-06-21', lowestPrice: 900 }),
      buildCleanRow({ date: '2026-06-21', lowestPrice: 800 }),
      buildCleanRow({ date: '2026-06-22' }),
      buildCleanRow({ date: '2026-06-23' }),
      buildCleanRow({ date: '2026-06-24' }),
      buildCleanRow({ date: '2026-06-25' }),
      buildCleanRow({ date: '2026-06-26' }),
      buildCleanRow({ date: '2026-06-27' }),
    ],
  };
  const result = verifyCleanData(cleaned);
  assert.equal(result.ok, false);
  assert.equal(result.duplicates, 1);
  assert.ok(result.errors[0].includes('重复'));
});

test('verifyCleanData detects missing required fields', () => {
  const row = buildCleanRow({ date: '2026-06-21' });
  delete row.avgPrice;
  const cleaned = {
    prices: [
      row,
      buildCleanRow({ date: '2026-06-22' }),
      buildCleanRow({ date: '2026-06-23' }),
      buildCleanRow({ date: '2026-06-24' }),
      buildCleanRow({ date: '2026-06-25' }),
      buildCleanRow({ date: '2026-06-26' }),
      buildCleanRow({ date: '2026-06-27' }),
    ],
  };
  const result = verifyCleanData(cleaned);
  assert.equal(result.ok, false);
  assert.equal(result.incomplete, 1);
  assert.ok(result.errors[0].includes('字段不完整'));
});

test('verifyCleanData detects anomalous prices', () => {
  const cleaned = {
    prices: [
      buildCleanRow({ date: '2026-06-21', avgPrice: 800, lowestPrice: 900 }),
      buildCleanRow({ date: '2026-06-22', lowestPrice: -1, avgPrice: 1000 }),
      buildCleanRow({ date: '2026-06-23', hasFlight: false, lowestPrice: 700, avgPrice: null }),
      buildCleanRow({ date: '2026-06-24' }),
      buildCleanRow({ date: '2026-06-25' }),
      buildCleanRow({ date: '2026-06-26' }),
      buildCleanRow({ date: '2026-06-27' }),
    ],
  };
  const result = verifyCleanData(cleaned);
  assert.equal(result.ok, false);
  assert.equal(result.anomalies, 3);
  assert.ok(result.errors.some((e) => e.includes('avgPrice') && e.includes('lowestPrice')));
  assert.ok(result.errors.some((e) => e.includes('非负整数')));
  assert.ok(result.errors.some((e) => e.includes('hasFlight=false')));
});

test('verifyCleanData detects missing expected dates', () => {
  const cleaned = {
    prices: [
      buildCleanRow({ date: '2026-06-21' }),
      buildCleanRow({ date: '2026-06-22' }),
      buildCleanRow({ date: '2026-06-23' }),
      buildCleanRow({ date: '2026-06-24' }),
      buildCleanRow({ date: '2026-06-25' }),
      buildCleanRow({ date: '2026-06-26' }),
    ],
  };
  const result = verifyCleanData(cleaned);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('2026-06-27')));
});
