import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  escapeHtml,
  buildHtml,
  buildGuideData,
  generateGuide,
} from '../tools/gen-phuket-guide.mjs';

test('escapeHtml escapes HTML special characters', () => {
  assert.equal(escapeHtml('<a href="x">y</a>'), '&lt;a href=&quot;x&quot;&gt;y&lt;/a&gt;');
  assert.equal(escapeHtml("'test'"), '&#39;test&#39;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('buildGuideData loads transport, itinerary and practical data', () => {
  const guide = buildGuideData();
  assert.ok(guide.title);
  assert.ok(guide.trip);
  assert.ok(guide.transport);
  assert.ok(guide.itinerary);
  assert.ok(guide.practical);
  assert.equal(guide.transport.options.length, 3);
  assert.equal(guide.itinerary.days.length, 4);
  assert.equal(guide.practical.accommodation.options.length, 9);
});

test('buildHtml contains all integrated sections', () => {
  const guide = buildGuideData();
  const html = buildHtml(guide);

  assert.match(html, /广州 → 普吉岛/);
  assert.match(html, /交通方案/);
  assert.match(html, /每日行程安排/);
  assert.match(html, /住宿建议/);
  assert.match(html, /餐饮推荐/);
  assert.match(html, /预算明细/);
  assert.match(html, /实用贴士清单/);
  assert.match(html, /CZ6063/);
  assert.match(html, /Day 1 · 周四 · 2026-08-13/);
  assert.match(html, /Day 4 · 周日 · 2026-08-16/);
  assert.match(html, /<\/html>/);
});

test('buildHtml escapes dangerous content', () => {
  const guide = buildGuideData();
  const html = buildHtml({ ...guide, title: '<script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('generateGuide writes JSON and HTML files and returns metadata', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'phuket-guide-'));
  const jsonPath = join(tmpDir, 'phuket-guide.json');
  const htmlPath = join(tmpDir, 'phuket-guide.html');

  const result = generateGuide({ jsonPath, htmlPath, silent: true });

  assert.equal(result.jsonPath, jsonPath);
  assert.equal(result.htmlPath, htmlPath);
  assert.ok(result.htmlLength > 0);
  assert.equal(result.sections, 8);

  assert.ok(existsSync(jsonPath));
  assert.ok(existsSync(htmlPath));

  const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
  assert.equal(json.itinerary.days.length, 4);
  assert.equal(json.practical.accommodation.options.length, 9);

  const html = readFileSync(htmlPath, 'utf8');
  assert.match(html, /预算明细/);
  assert.match(html, /芭东海滩/);

  rmSync(tmpDir, { recursive: true, force: true });
});
