import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildHtml,
  generatePractical,
  PRACTICAL_DATA,
} from '../tools/gen-phuket-practical.mjs';

test('PRACTICAL_DATA has required sections', () => {
  assert.ok(PRACTICAL_DATA.title);
  assert.ok(PRACTICAL_DATA.trip);
  assert.ok(PRACTICAL_DATA.accommodation);
  assert.ok(PRACTICAL_DATA.dining);
  assert.ok(PRACTICAL_DATA.budget);
  assert.ok(PRACTICAL_DATA.tips);

  assert.equal(PRACTICAL_DATA.accommodation.options.length, 9);
  for (const opt of PRACTICAL_DATA.accommodation.options) {
    assert.ok(opt.area);
    assert.ok(opt.tier);
    assert.ok(['经济', '舒适', '高端'].includes(opt.tier));
    assert.ok(opt.price);
  }

  assert.ok(PRACTICAL_DATA.dining.categories.length >= 4);
  for (const cat of PRACTICAL_DATA.dining.categories) {
    assert.ok(cat.category);
    assert.ok(Array.isArray(cat.mustTry));
    assert.ok(cat.avgPrice);
  }

  assert.ok(PRACTICAL_DATA.budget.items.length >= 5);
  assert.ok(PRACTICAL_DATA.budget.total.economy);
  assert.ok(PRACTICAL_DATA.budget.total.standard);
  assert.ok(PRACTICAL_DATA.budget.total.premium);

  assert.ok(PRACTICAL_DATA.tips.categories.length >= 5);
});

test('buildHtml contains all four required sections', () => {
  const html = buildHtml(PRACTICAL_DATA);
  assert.match(html, /住宿建议/);
  assert.match(html, /餐饮推荐/);
  assert.match(html, /预算明细/);
  assert.match(html, /实用贴士/);
  assert.match(html, /经济档/);
  assert.match(html, /舒适档/);
  assert.match(html, /高端档/);
  assert.match(html, /<\/html>/);
});

test('buildHtml escapes dangerous content', () => {
  const data = {
    ...PRACTICAL_DATA,
    title: '<script>alert(1)</script>',
  };
  const html = buildHtml(data);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('generatePractical writes JSON and HTML files and returns metadata', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'phuket-practical-'));
  const jsonPath = join(tmpDir, 'phuket-practical.json');
  const htmlPath = join(tmpDir, 'phuket-practical.html');

  const result = generatePractical({ jsonPath, htmlPath, silent: true });

  assert.equal(result.jsonPath, jsonPath);
  assert.equal(result.htmlPath, htmlPath);
  assert.ok(result.htmlLength > 0);
  assert.equal(result.accommodationOptions, 9);
  assert.ok(result.diningCategories >= 4);
  assert.ok(result.budgetItems >= 5);
  assert.ok(result.tipCategories >= 5);

  assert.ok(existsSync(jsonPath));
  assert.ok(existsSync(htmlPath));

  const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
  assert.equal(json.accommodation.options.length, 9);
  assert.equal(json.budget.total.economy, PRACTICAL_DATA.budget.total.economy);

  const html = readFileSync(htmlPath, 'utf8');
  assert.match(html, /普吉岛 4 天 3 夜/);
  assert.match(html, /芭东海滩/);

  rmSync(tmpDir, { recursive: true, force: true });
});
