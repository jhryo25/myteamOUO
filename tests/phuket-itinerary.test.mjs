import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  escapeHtml,
  buildHtml,
  generateItinerary,
  TRIP_DATA,
} from '../tools/gen-phuket-itinerary.mjs';

test('escapeHtml escapes HTML special characters', () => {
  assert.equal(escapeHtml('<a href="x">y</a>'), '&lt;a href=&quot;x&quot;&gt;y&lt;/a&gt;');
  assert.equal(escapeHtml("'test'"), '&#39;test&#39;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('TRIP_DATA has 4 days with 3-4 activities each', () => {
  assert.equal(TRIP_DATA.days.length, 4);
  for (const day of TRIP_DATA.days) {
    assert.ok(day.schedule.length >= 3 && day.schedule.length <= 4);
    assert.ok(day.area);
    assert.ok(day.theme);
    for (const item of day.schedule) {
      assert.ok(item.timeSlot);
      assert.ok(item.activity);
      assert.ok(item.venue);
      assert.ok(item.duration);
      assert.ok(item.fee);
      assert.ok(item.transport);
    }
  }
});

test('buildHtml contains title, route logic, daily cards and disclaimer', () => {
  const html = buildHtml(TRIP_DATA);
  assert.match(html, /普吉岛 4 天 3 夜/);
  assert.match(html, /整体路线逻辑/);
  assert.match(html, /Day 1/);
  assert.match(html, /Day 4/);
  assert.match(html, /人均费用参考/);
  assert.match(html, /实用贴士/);
  assert.match(html, /Coral Island/);
  assert.match(html, /<\/html>/);
});

test('buildHtml escapes dangerous content', () => {
  const data = {
    ...TRIP_DATA,
    title: '<script>alert(1)</script>',
  };
  const html = buildHtml(data);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('generateItinerary writes JSON and HTML files and returns metadata', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'phuket-itinerary-'));
  const jsonPath = join(tmpDir, 'phuket-itinerary.json');
  const htmlPath = join(tmpDir, 'phuket-itinerary.html');

  const result = generateItinerary({ jsonPath, htmlPath, silent: true });

  assert.equal(result.jsonPath, jsonPath);
  assert.equal(result.htmlPath, htmlPath);
  assert.ok(result.htmlLength > 0);
  assert.equal(result.days, 4);
  assert.equal(result.activities, TRIP_DATA.days.reduce((sum, d) => sum + d.schedule.length, 0));

  assert.ok(existsSync(jsonPath));
  assert.ok(existsSync(htmlPath));

  const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
  assert.equal(json.days.length, 4);
  assert.equal(json.trip.preferences.join(','), '城市人文,夜生活');

  const html = readFileSync(htmlPath, 'utf8');
  assert.match(html, /Day 1 · 周四 · 2026-08-13/);
  assert.match(html, /Day 4 · 周日 · 2026-08-16/);

  rmSync(tmpDir, { recursive: true, force: true });
});
