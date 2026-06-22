import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PRODUCT_TEMPLATES,
  normalizeReviewScorecard,
  publicProductTemplates,
  reviewScorecardPasses,
} from '../product-guidance.mjs';

test('product templates describe a complete first-task outcome without auto execution', () => {
  assert.equal(PRODUCT_TEMPLATES.length, 4);
  assert.equal(new Set(PRODUCT_TEMPLATES.map(item => item.id)).size, PRODUCT_TEMPLATES.length);
  for (const template of PRODUCT_TEMPLATES) {
    assert.equal(template.mode, 'plan');
    assert.ok(template.prompt.length > 60);
    assert.ok(template.deliverable.length > 4);
  }
  const publicCopy = publicProductTemplates();
  publicCopy[0].title = 'changed';
  assert.notEqual(PRODUCT_TEMPLATES[0].title, 'changed');
});

test('manual gate scorecard only passes when every trust dimension is confirmed', () => {
  const incomplete = normalizeReviewScorecard({
    correctness: true,
    completeness: true,
    evidence: false,
    safety: true,
  });
  assert.deepEqual(incomplete, {
    correctness: true,
    completeness: true,
    evidence: false,
    safety: true,
  });
  assert.equal(reviewScorecardPasses(incomplete), false);
  assert.equal(reviewScorecardPasses({
    correctness: true,
    completeness: true,
    evidence: true,
    safety: true,
  }), true);
  assert.equal(normalizeReviewScorecard('yes'), null);
});

test('welcome flow fills a template and gate UI submits evidence-backed scorecard', () => {
  const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(source, /function renderWelcome\(/);
  assert.match(source, /function applyProductTemplate\(/);
  assert.match(source, /function bindGateScorecards\(/);
  assert.match(source, /JSON\.stringify\(\{ decision, note, scorecard \}\)/);
  assert.match(server, /pathname === '\/api\/product-templates'/);
  assert.match(server, /通过 Gate 前必须确认评分卡的全部项目/);
});
