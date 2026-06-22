import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRouteReport, buildRouteCsv } from '../tools/identify-jmu-routes.mjs';

test('buildRouteReport identifies Jiamusi Dongjiao Airport as JMU/ZYJM', () => {
  const report = buildRouteReport();
  assert.equal(report.airport.iata, 'JMU');
  assert.equal(report.airport.icao, 'ZYJM');
  assert.equal(report.airport.name_cn, '佳木斯东郊机场');
  assert.equal(report.airport.name_en, 'Jiamusi Dongjiao Airport');
});

test('buildRouteReport contains at least 3 routes with airlines', () => {
  const report = buildRouteReport();
  assert.ok(report.routes.length >= 3, `expected at least 3 routes, got ${report.routes.length}`);
  for (const route of report.routes) {
    assert.ok(route.airlines.length > 0, `route ${route.route_id} has no airlines`);
    assert.ok(route.airlines.every((a) => a.code && a.name_cn), `route ${route.route_id} has incomplete airline info`);
  }
});

test('buildRouteReport summary matches route data', () => {
  const report = buildRouteReport();
  const domesticRoutes = report.routes.filter((r) => r.route_type.startsWith('国内') || r.route_type === '省内支线');
  const internationalRoutes = report.routes.filter((r) => r.route_type.startsWith('国际'));
  const activeRoutes = report.routes.filter((r) => r.status_in_last_15_days === '执飞');
  const airlines = new Set();
  for (const route of report.routes) {
    for (const airline of route.airlines) {
      airlines.add(airline.name_cn);
    }
  }
  assert.equal(report.summary.total_routes, report.routes.length);
  assert.equal(report.summary.domestic_routes, domesticRoutes.length);
  assert.equal(report.summary.international_routes, internationalRoutes.length);
  assert.equal(report.summary.airlines_count, airlines.size);
  assert.equal(report.summary.active_in_last_15_days, activeRoutes.length);
});

test('buildRouteCsv produces valid header and rows', () => {
  const report = buildRouteReport();
  const csv = buildRouteCsv(report);
  const lines = csv.split('\n');
  assert.ok(lines[0].includes('airport_iata'));
  assert.ok(lines[0].includes('route_id'));
  assert.equal(lines.length, report.routes.length + 1);
  assert.ok(lines[1].startsWith('JMU'));
});
