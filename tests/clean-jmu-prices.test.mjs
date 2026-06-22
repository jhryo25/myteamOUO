import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAirlineName,
  extractFlightStats,
  cleanPrices,
} from '../tools/clean-jmu-prices.mjs';

test('normalizeAirlineName handles HNA prefix and abbreviations', () => {
  assert.equal(normalizeAirlineName('新海航｜海南航空'), '海南航空');
  assert.equal(normalizeAirlineName('新海航｜首都航空'), '首都航空');
  assert.equal(normalizeAirlineName('东方航空'), '中国东方航空');
  assert.equal(normalizeAirlineName('中国国航'), '中国国际航空');
  assert.equal(normalizeAirlineName('南方航空'), '中国南方航空');
  assert.equal(normalizeAirlineName('山东航空'), '山东航空');
  assert.equal(normalizeAirlineName(''), '未知航司');
});

test('extractFlightStats computes lowest, average, airlines and discount rate', () => {
  const listData = {
    flights: [
      {
        policy: { price: 800, rate: 0.6 },
        flightItem: {
          flights: [{ airline: { name: '东方航空' } }],
        },
      },
      {
        policy: { price: 1200, rate: 0.9 },
        flightItem: {
          flights: [{ airline: { name: '中国国航' } }],
        },
      },
      {
        policy: { price: 800, rate: 0.6 },
        flightItem: {
          flights: [{ airline: { name: '新海航｜东方航空' } }],
        },
      },
    ],
  };
  const stats = extractFlightStats(listData);
  assert.equal(stats.lowestPrice, 800);
  assert.equal(stats.avgPrice, 933);
  assert.deepEqual(stats.cheapestAirlines.sort(), ['中国东方航空']);
  assert.equal(stats.flightCount, 3);
  assert.equal(stats.discountRate, 0.6);
});

test('extractFlightStats returns nulls when no priced flights', () => {
  const stats = extractFlightStats({ flights: [{}] });
  assert.equal(stats.lowestPrice, null);
  assert.equal(stats.avgPrice, null);
  assert.deepEqual(stats.cheapestAirlines, []);
  assert.equal(stats.discountRate, null);
});

test('cleanPrices deduplicates, marks missing values and computes summaries', () => {
  const prices = [
    {
      date: '2026-06-21',
      origin: '北京',
      originCode: 'BJS',
      destination: '佳木斯',
      destinationCode: 'JMU',
      lowestPrice: 900,
      cheapestAirlines: '中国联合航空',
      flightCount: 2,
      sourceUrl: 'url1',
    },
    // duplicate: should be discarded
    {
      date: '2026-06-21',
      origin: '北京',
      originCode: 'BJS',
      destination: '佳木斯',
      destinationCode: 'JMU',
      lowestPrice: 1000,
      cheapestAirlines: '中国国航',
      flightCount: 2,
      sourceUrl: 'url1b',
    },
    {
      date: '2026-06-21',
      origin: '上海',
      originCode: 'SHA',
      destination: '佳木斯',
      destinationCode: 'JMU',
      lowestPrice: null,
      cheapestAirlines: '',
      flightCount: 0,
      sourceUrl: 'url2',
    },
    {
      date: '2026-06-22',
      origin: '北京',
      originCode: 'BJS',
      destination: '佳木斯',
      destinationCode: 'JMU',
      lowestPrice: 700,
      cheapestAirlines: '中国联合航空',
      flightCount: 1,
      sourceUrl: 'url3',
    },
  ];

  const raw = {
    'BJS_2026-06-21': {
      routeCode: 'BJS',
      date: '2026-06-21',
      listData: {
        flights: [
          {
            policy: { price: 900, rate: 0.5 },
            flightItem: { flights: [{ airline: { name: '中国联合航空' } }] },
          },
          {
            policy: { price: 1100, rate: 0.7 },
            flightItem: { flights: [{ airline: { name: '中国国航' } }] },
          },
        ],
      },
    },
    'SHA_2026-06-21': {
      routeCode: 'SHA',
      date: '2026-06-21',
      listData: { flights: [] },
    },
    'BJS_2026-06-22': {
      routeCode: 'BJS',
      date: '2026-06-22',
      listData: {
        flights: [
          {
            policy: { price: 700, rate: 0.4 },
            flightItem: { flights: [{ airline: { name: '中国联合航空' } }] },
          },
        ],
      },
    },
  };

  const result = cleanPrices({
    meta: { destination: '佳木斯', destinationCode: 'JMU' },
    prices,
    raw,
  });

  assert.equal(result.prices.length, 3);
  assert.equal(result.prices[0].originCode, 'BJS');
  assert.equal(result.prices[0].lowestPrice, 900);
  assert.equal(result.prices[0].avgPrice, 1000);
  assert.equal(result.prices[0].discountRate, 0.5);

  const sha = result.prices.find((p) => p.originCode === 'SHA');
  assert.equal(sha.hasFlight, false);
  assert.equal(sha.lowestPrice, null);
  assert.equal(sha.avgPrice, null);
  assert.deepEqual(sha.cheapestAirlines, []);

  assert.equal(result.dailySummary.length, 2);
  const day21 = result.dailySummary.find((d) => d.date === '2026-06-21');
  assert.equal(day21.routesWithPrice, 1);
  assert.equal(day21.dailyLowestPrice, 900);
  assert.equal(day21.dailyAvgPrice, 900);

  const day22 = result.dailySummary.find((d) => d.date === '2026-06-22');
  assert.equal(day22.dailyLowestPrice, 700);

  assert.equal(result.routeSummary.length, 2);
  const bjsRoute = result.routeSummary.find((r) => r.routeId === 'BJS-JMU');
  assert.equal(bjsRoute.datesWithPrice, 2);
  assert.equal(bjsRoute.minLowestPrice, 700);
  assert.equal(bjsRoute.avgLowestPrice, 800);

  assert.equal(result.overallSummary.totalRouteDateCombos, 3);
  assert.equal(result.overallSummary.combosWithPrice, 2);
  assert.equal(result.overallSummary.missingCombos, 1);
  assert.equal(result.overallSummary.globalLowestPrice, 700);
});
