import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  escapeHtml,
  dailyChartData,
  computeBestCombo,
  buildHtml,
  generateReport,
} from '../tools/gen-jmu-report.mjs';

const fixture = {
  meta: {
    generatedAt: '2026-06-21T06:05:02.004Z',
    sourceReport: 'Ctrip Mobile H5',
    destination: '佳木斯',
    destinationCode: 'JMU',
    dateRangeStart: '2026-06-21',
    dateRangeEnd: '2026-06-22',
    totalRows: 2,
  },
  prices: [
    {
      date: '2026-06-21',
      origin: '北京',
      originCode: 'BJS',
      destination: '佳木斯',
      destinationCode: 'JMU',
      routeId: 'BJS-JMU',
      lowestPrice: 800,
      avgPrice: 900,
      cheapestAirlines: ['中国联合航空'],
      cheapestAirlineText: '中国联合航空',
      flightCount: 3,
      hasFlight: true,
      discountRate: 0.5,
      sourceUrl: 'https://m.ctrip.com/html5/flight/BJS-JMU-day-0.html',
    },
    {
      date: '2026-06-22',
      origin: '上海',
      originCode: 'SHA',
      destination: '佳木斯',
      destinationCode: 'JMU',
      routeId: 'SHA-JMU',
      lowestPrice: null,
      avgPrice: null,
      cheapestAirlines: [],
      cheapestAirlineText: '',
      flightCount: 0,
      hasFlight: false,
      discountRate: null,
      sourceUrl: 'https://m.ctrip.com/html5/flight/SHA-JMU-day-1.html',
    },
  ],
  dailySummary: [
    {
      date: '2026-06-21',
      routeCount: 1,
      routesWithPrice: 1,
      dailyLowestPrice: 800,
      dailyAvgPrice: 900,
      minDiscountRate: 0.5,
      avgDiscountRate: 0.5,
      cheapestRoute: 'BJS-JMU',
      cheapestRouteOrigin: '北京',
      cheapestAirlines: ['中国联合航空'],
    },
    {
      date: '2026-06-22',
      routeCount: 1,
      routesWithPrice: 0,
      dailyLowestPrice: null,
      dailyAvgPrice: null,
      minDiscountRate: null,
      avgDiscountRate: null,
      cheapestRoute: null,
      cheapestRouteOrigin: null,
      cheapestAirlines: [],
    },
  ],
  routeSummary: [
    {
      routeId: 'BJS-JMU',
      origin: '北京',
      originCode: 'BJS',
      destination: '佳木斯',
      destinationCode: 'JMU',
      datesWithPrice: 1,
      minLowestPrice: 800,
      avgLowestPrice: 800,
      maxLowestPrice: 800,
      avgFlightPrice: 900,
      avgDiscountRate: 0.5,
    },
    {
      routeId: 'SHA-JMU',
      origin: '上海',
      originCode: 'SHA',
      destination: '佳木斯',
      destinationCode: 'JMU',
      datesWithPrice: 0,
      minLowestPrice: null,
      avgLowestPrice: null,
      maxLowestPrice: null,
      avgFlightPrice: null,
      avgDiscountRate: null,
    },
  ],
  overallSummary: {
    totalRouteDateCombos: 2,
    combosWithPrice: 1,
    missingCombos: 1,
    missingCombosList: [
      { date: '2026-06-22', originCode: 'SHA', origin: '上海', reason: '无航班或当日无报价' },
    ],
    globalLowestPrice: 800,
    globalAvgLowestPrice: 800,
    globalAvgFlightPrice: 900,
    globalMinDiscountRate: 0.5,
    globalAvgDiscountRate: 0.5,
  },
};

test('escapeHtml escapes HTML special characters', () => {
  assert.equal(escapeHtml('<a href="x">y</a>'), '&lt;a href=&quot;x&quot;&gt;y&lt;/a&gt;');
  assert.equal(escapeHtml("'test'"), '&#39;test&#39;');
  assert.equal(escapeHtml(null), '');
});

test('dailyChartData maps daily summary and drops missing prices', () => {
  const chart = dailyChartData(fixture);
  assert.equal(chart.length, 1);
  assert.equal(chart[0].date, '2026-06-21');
  assert.equal(chart[0].label, '06/21');
  assert.equal(chart[0].dailyLowestPrice, 800);
  assert.equal(chart[0].dailyAvgPrice, 900);
});

test('computeBestCombo picks the cheapest flight per day and sums prices', () => {
  const combo = computeBestCombo(fixture);
  assert.equal(combo.strategy, '每天选取所有航线中的最低价航班求和');
  assert.equal(combo.totalPrice, 800);
  assert.equal(combo.currency, 'CNY');
  assert.equal(combo.daysWithPrice, 1);
  assert.equal(combo.daysMissing, 1);
  assert.deepEqual(combo.missingDates, ['2026-06-22']);
  assert.equal(combo.items.length, 1);
  assert.equal(combo.items[0].date, '2026-06-21');
  assert.equal(combo.items[0].lowestPrice, 800);
  assert.equal(combo.items[0].cheapestAirlineText, '中国联合航空');
});

test('buildHtml contains title, chart, tables and embedded data', () => {
  const html = buildHtml(fixture);
  assert.match(html, /佳木斯机票价格报告/);
  assert.match(html, /每日最低价趋势/);
  assert.match(html, /最佳价格组合/);
  assert.match(html, /7 天总价格/);
  assert.match(html, /<canvas[^>]*id="priceChart"/);
  assert.match(html, /REPORT_DATA/);
  assert.match(html, /BJS-JMU/);
  assert.match(html, /SHA-JMU/);
  assert.match(html, /中国联合航空/);
  assert.match(html, /数据源：Ctrip Mobile H5/);
  assert.match(html, /2026-06-21 ~ 2026-06-22/);
  assert.match(html, /<\/html>/);
});

test('generateReport writes the HTML file and returns metadata', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'jmu-report-'));
  const inputPath = join(tmpDir, 'clean.json');
  const outputPath = join(tmpDir, 'report.html');
  const comboOutputPath = join(tmpDir, 'combo.json');
  writeFileSync(inputPath, JSON.stringify(fixture));

  const result = generateReport({ inputPath, outputPath, comboOutputPath, silent: true });

  assert.ok(existsSync(outputPath));
  assert.equal(result.path, outputPath);
  assert.equal(result.comboPath, comboOutputPath);
  assert.ok(result.htmlLength > 0);
  assert.equal(result.pricesCount, 2);
  assert.equal(result.days, 2);
  assert.equal(result.routes, 2);
  assert.equal(result.bestCombo.totalPrice, 800);
  assert.equal(result.bestCombo.daysWithPrice, 1);
  assert.equal(result.bestCombo.daysMissing, 1);

  const html = readFileSync(outputPath, 'utf8');
  assert.match(html, /id="detailTable"/);
  assert.match(html, /id="priceChart"/);
  assert.match(html, /最佳价格组合/);

  const combo = JSON.parse(readFileSync(comboOutputPath, 'utf8'));
  assert.equal(combo.totalPrice, 800);
  assert.equal(combo.items.length, 1);

  rmSync(tmpDir, { recursive: true, force: true });
});
