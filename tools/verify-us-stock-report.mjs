import fs from 'fs';
import path from 'path';

const REPORT_DIR = 'reports';
const DATE = '20260620';

const mdPath = path.join(REPORT_DIR, `us_stock_daily_${DATE}.md`);
const htmlPath = path.join(REPORT_DIR, `us_stock_news_${DATE}.html`);
const statsPath = path.join(REPORT_DIR, `us_stock_stats_${DATE}.json`);
const focusPath = path.join(REPORT_DIR, `us_stock_focus_${DATE}.json`);
const indicesPath = path.join(REPORT_DIR, `us_stock_indices_${DATE}.json`);

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function checkFile(p) {
  if (!fs.existsSync(p)) throw new Error(`文件不存在: ${p}`);
  const stat = fs.statSync(p);
  if (stat.size === 0) throw new Error(`文件为空: ${p}`);
  return stat.size;
}

const issues = [];

// 0. 文件非空
const mdSize = checkFile(mdPath);
const htmlSize = checkFile(htmlPath);

const md = fs.readFileSync(mdPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
const stats = loadJson(statsPath);
const focus = loadJson(focusPath);
const indices = loadJson(indicesPath);

// 1. Markdown 标题层级
const headingLines = md.split('\n').filter(l => /^#{1,6} /.test(l));
const h1s = headingLines.filter(l => l.startsWith('# '));
if (h1s.length !== 1) issues.push(`Markdown H1 数量 = ${h1s.length}（应为 1）`);

const headingLevels = headingLines.map(l => l.match(/^(#{1,6}) /)[1].length);
for (let i = 1; i < headingLevels.length; i++) {
  if (headingLevels[i] > headingLevels[i - 1] + 1) {
    issues.push(`Markdown 标题层级跳级: ${headingLevels[i - 1]} -> ${headingLevels[i]} at "${headingLines[i]}"`);
  }
}

// 2. Markdown 必要章节
const requiredSections = ['市场综述', '三大指数', '板块热点', '重点个股', '要闻摘要'];
for (const sec of requiredSections) {
  if (!md.includes(sec)) issues.push(`Markdown 缺失章节: ${sec}`);
}

// 3. HTML 基础结构
const requiredHtmlTags = ['<!DOCTYPE html>', '<html', '</html>', '<head>', '</head>', '<body>', '</body>', '<title>', '</title>'];
for (const tag of requiredHtmlTags) {
  if (!html.includes(tag)) issues.push(`HTML 缺失结构: ${tag}`);
}

// 4. HTML 标签平衡
const tagPairs = [
  ['html', 'html'], ['head', 'head'], ['body', 'body'],
  ['header', 'header'], ['main', 'main'], ['footer', 'footer'],
  ['section', 'section'], ['table', 'table'], ['thead', 'thead'], ['tbody', 'tbody'],
  ['tr', 'tr'], ['a', 'a'], ['strong', 'strong'], ['small', 'small']
];
for (const [open, close] of tagPairs) {
  const openRe = new RegExp(`<${open}\\b`, 'g');
  const closeRe = new RegExp(`</${close}>`, 'g');
  const opens = (html.match(openRe) || []).length;
  const closes = (html.match(closeRe) || []).length;
  if (opens !== closes) issues.push(`HTML 标签不平衡: <${open}> 开=${opens}, 闭=${closes}`);
}

// th/td 成对检查（允许 th 只在 thead）
for (const [open, close] of [['th', 'th'], ['td', 'td']]) {
  const openRe = new RegExp(`<${open}\\b`, 'g');
  const closeRe = new RegExp(`</${close}>`, 'g');
  const opens = (html.match(openRe) || []).length;
  const closes = (html.match(closeRe) || []).length;
  if (opens !== closes) issues.push(`HTML 标签不平衡: <${open}> 开=${opens}, 闭=${closes}`);
}

// 5. 无占位符
const placeholderRe = /TODO|FIXME|占位|暂无|未获取|待补充|N\/A|null|\$\{[^}]*\}/i;
if (placeholderRe.test(md)) issues.push('Markdown 中存在占位符残留');
if (placeholderRe.test(html)) issues.push('HTML 中存在占位符残留');

// 6. 关键数据抽检：指数收盘与 JSON 一致
for (const idx of stats.indices) {
  const expected = idx.close.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (!md.includes(expected)) issues.push(`Markdown 缺少指数 ${idx.symbol} 收盘价: ${expected}`);
  if (!html.includes(expected)) issues.push(`HTML 缺少指数 ${idx.symbol} 收盘价: ${expected}`);
}

// 7. 重点个股数量与 focus JSON 一致（报告中列出的个股数量）
const focusSymbols = focus.quotes.map(q => q.symbol);
// 仅统计 "## 三、重点个股" 到 "## 四、要闻摘要" 区间内的代码行
const sectionMatch = md.match(/## 三、重点个股[\s\S]*?## 四、要闻摘要/);
const focusSectionMd = sectionMatch ? sectionMatch[0] : '';
const focusSymbolsInMd = [...focusSectionMd.matchAll(/\|\s*(NVDA|INTC|SNDK|AAPL|AMD|TSLA|MSFT|AMZN|META|GOOGL|JPM|ACN|GLW|CTSH|SMCI|KR|STLD)\s*\|/g)].map(m => m[1]);
const uniqueFocusSymbolsInMd = [...new Set(focusSymbolsInMd)];
if (uniqueFocusSymbolsInMd.length !== focusSymbols.length) {
  issues.push(`Markdown 重点个股数量 ${uniqueFocusSymbolsInMd.length} 与 focus JSON ${focusSymbols.length} 不一致`);
}

// 8. Top 涨跌与 focus JSON 一致
for (const g of stats.stocks.topGainers) {
  if (!focusSymbols.includes(g.symbol)) issues.push(`涨幅榜 ${g.symbol} 不在 focus JSON 中`);
}
for (const l of stats.stocks.topLosers) {
  if (!focusSymbols.includes(l.symbol)) issues.push(`跌幅榜 ${l.symbol} 不在 focus JSON 中`);
}

// 9. 板块热点 Top3 与 stats 一致
for (const s of stats.top3GainerSectors) {
  if (!md.includes(s.sector)) issues.push(`Markdown 缺少领涨板块 ${s.sector}`);
}
for (const s of stats.top3LoserSectors) {
  if (!md.includes(s.sector)) issues.push(`Markdown 缺少领跌板块 ${s.sector}`);
}

// 10. 个股数据一致性抽检（取前 3 只）
function formatNumber(n, decimals = 2) {
  const parts = n.toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}
for (let i = 0; i < Math.min(3, focus.quotes.length); i++) {
  const q = focus.quotes[i];
  const price = formatNumber(q.price);
  const change = (q.change >= 0 ? '+' : '') + formatNumber(q.change);
  const pct = (q.changePercent >= 0 ? '+' : '') + q.changePercent.toFixed(2) + '%';
  if (!md.includes(price) || !md.includes(change) || !md.includes(pct)) {
    issues.push(`Markdown 重点个股 ${q.symbol} 数据不一致`);
  }
}

// 11. 日期一致性
if (!md.includes('2026-06-19')) issues.push('Markdown 报告日期不一致');
if (!html.includes('20260620')) issues.push('HTML 报告日期不一致');

// 12. 表格非空
const mdTableRows = (md.match(/\|.*\|.*\|/g) || []).length;
if (mdTableRows < 10) issues.push(`Markdown 表格行过少: ${mdTableRows}`);

const htmlTrRows = (html.match(/<tr>/g) || []).length;
if (htmlTrRows < 10) issues.push(`HTML 表格行过少: ${htmlTrRows}`);

// 输出
console.log(`报告文件大小: MD=${mdSize} bytes, HTML=${htmlSize} bytes`);
console.log(`章节数: ${requiredSections.length}，个股 focus: ${focusSymbols.length}，指数: ${stats.indices.length}`);

if (issues.length === 0) {
  console.log('✅ 所有验证通过');
} else {
  console.log(`❌ 发现 ${issues.length} 个问题：`);
  for (const issue of issues) console.log(`  - ${issue}`);
  process.exit(1);
}
