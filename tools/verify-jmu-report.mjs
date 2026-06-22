import fs from 'node:fs';
import vm from 'node:vm';

const htmlPath = 'reports/jiamusi_flight_report_20260621.html';
const dataPath = 'reports/jiamusi_flight_clean_data_20260621.json';

const html = fs.readFileSync(htmlPath, 'utf8');
const cleanData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

let allOk = true;
function pass(name, extra = '') {
  console.log(`PASS: ${name}${extra ? ' ' + extra : ''}`);
}
function fail(name, extra = '') {
  console.log(`FAIL: ${name}${extra ? ' ' + extra : ''}`);
  allOk = false;
}

// 1. 基本结构
if (html.startsWith('<!DOCTYPE html>')) pass('DOCTYPE 声明');
else fail('DOCTYPE 声明');

if (html.includes('<meta charset="UTF-8">')) pass('UTF-8 字符集');
else fail('UTF-8 字符集');

if (html.includes('<meta name="viewport"')) pass('Viewport 响应式');
else fail('Viewport 响应式');

if (!html.includes('\uFFFD')) pass('无乱码替代字符');
else fail('无乱码替代字符');

// 2. 提取并解析内嵌 REPORT_DATA
const dataMatch = html.match(/const REPORT_DATA = (\{[\s\S]*?\});/);
if (!dataMatch) {
  fail('内嵌 REPORT_DATA');
  process.exit(1);
}
let embedded;
try {
  embedded = JSON.parse(dataMatch[1]);
  pass('内嵌 REPORT_DATA 可解析为 JSON');
} catch (e) {
  fail('内嵌 REPORT_DATA JSON 解析', e.message);
  process.exit(1);
}

// 3. 数据一致性
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
if (same(embedded.meta?.totalRows, cleanData.meta?.totalRows)) pass('meta.totalRows 一致');
else fail('meta.totalRows 不一致', `${embedded.meta?.totalRows} vs ${cleanData.meta?.totalRows}`);

if (same(embedded.prices?.length, cleanData.prices?.length)) pass('prices 长度一致');
else fail('prices 长度不一致');

if (same(embedded.dailySummary, cleanData.dailySummary)) pass('dailySummary 一致');
else fail('dailySummary 不一致');

if (same(embedded.routeSummary, cleanData.routeSummary)) pass('routeSummary 一致');
else fail('routeSummary 不一致');

if (same(embedded.globalSummary, cleanData.globalSummary)) pass('globalSummary 一致');
else fail('globalSummary 不一致');

// 4. 标签完整性
const tags = ['html', 'head', 'body', 'main', 'section', 'table', 'thead', 'tbody', 'canvas', 'script'];
for (const tag of tags) {
  const open = (html.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
  const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
  if (open > 0 && close === open) pass(`标签 <${tag}> 开闭匹配 (${open})`);
  else fail(`标签 <${tag}> 开闭匹配`, `open=${open} close=${close}`);
}

// 5. 脚本语法检查
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (scriptMatch) {
  try {
    new vm.Script(scriptMatch[1], { filename: 'inline-report.js' });
    pass('内嵌脚本语法正确');
  } catch (e) {
    fail('内嵌脚本语法', e.message);
  }
} else {
  fail('未找到内嵌 script');
}

// 6. 日期覆盖
const dates = [...new Set(embedded.prices.map(p => p.date))].sort();
if (dates.length === 15) pass('覆盖 15 天');
else fail('覆盖天数', `${dates.length} 天`);

const expectedStart = '2026-06-21';
const expectedEnd = '2026-07-05';
if (dates[0] === expectedStart && dates[dates.length - 1] === expectedEnd) {
  pass('日期范围正确', `${dates[0]} ~ ${dates[dates.length - 1]}`);
} else {
  fail('日期范围', `${dates[0]} ~ ${dates[dates.length - 1]}`);
}

// 7. 航线覆盖
const routes = [...new Set(embedded.prices.map(p => p.routeId))].sort();
if (routes.length === 11) pass('覆盖 11 条航线');
else fail('航线数', `${routes.length}`);

// 8. 总条数
if (embedded.prices.length === 165) pass('总数据条数 165');
else fail('总数据条数', `${embedded.prices.length}`);

// 9. 缺失数据
const missing = embedded.prices.filter(p => !p.hasFlight);
if (missing.length === 5) pass('缺失组合 5 条');
else fail('缺失组合数', `${missing.length}`);

// 10. 关键 UI 元素
for (const id of ['priceChart', 'tooltip', 'originFilter', 'dateFilter', 'flightFilter', 'detailTable']) {
  if (html.includes(`id="${id}"`)) pass(`包含元素 #${id}`);
  else fail(`缺少元素 #${id}`);
}

// 11. 文件大小
const stats = fs.statSync(htmlPath);
console.log(`INFO: 文件大小 ${(stats.size / 1024).toFixed(2)} KB`);

process.exit(allOk ? 0 : 1);
