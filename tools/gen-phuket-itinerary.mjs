#!/usr/bin/env node
/**
 * 生成普吉岛 4 天 3 夜城市人文+夜生活行程
 * 输出：reports/phuket-itinerary.html（可直接浏览器打开）
 *       reports/phuket-itinerary.json（结构化数据）
 *
 * 设计要点：
 *   - 按芭东/普吉镇/卡塔卡伦/离岛区域聚类，减少岛内折返。
 *   - 每天 3-4 个具体安排，标注停留时长、费用、交通方式。
 *   - 单文件 HTML，内嵌 CSS，与交通方案视觉风格保持一致。
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORTS_DIR = join(ROOT, 'reports');

export const TRIP_DATA = {
  title: '普吉岛 4 天 3 夜 · 城市人文 + 夜生活行程',
  trip: {
    origin: '广州',
    destination: '普吉岛 (Phuket, Thailand)',
    airport: '普吉国际机场 (HKT)',
    dates: {
      start: '2026-08-13',
      end: '2026-08-16',
      duration: '4天3夜',
    },
    preferences: ['城市人文', '夜生活'],
    accommodation: '建议住宿：芭东海滩区域，交通便利、夜生活集中',
  },
  routeLogic: {
    summary:
      '以“区域聚类、动静交替”为原则：Day1 在芭东适应时差并体验夜生活；Day2 集中逛普吉镇老街与博物馆，满足城市人文偏好；Day3 沿西海岸卡塔-卡伦-神仙半岛看日落；Day4 上午安排离岛轻体验，中午前返回并前往机场。全程尽量避免东西海岸重复折返。',
    dailyTheme: [
      { day: 1, area: '芭东海滩', theme: '抵达 · 海滩日落 · 夜生活入门' },
      { day: 2, area: '普吉镇', theme: '老街人文 · 博物馆 · 夜市美食' },
      { day: 3, area: '卡塔/卡伦/神仙半岛', theme: '西海岸海滩 · 观景台 · 日落' },
      { day: 4, area: '珊瑚岛 + 返程', theme: '离岛轻体验 · 返程' },
    ],
  },
  days: [
    {
      day: 1,
      date: '2026-08-13',
      weekday: '周四',
      area: '芭东海滩 (Patong)',
      theme: '抵达与夜生活入门',
      schedule: [
        {
          timeSlot: '下午',
          start: '15:40',
          end: '17:30',
          activity: '抵达普吉国际机场并前往酒店',
          venue: '普吉国际机场 (HKT) → 芭东海滩酒店',
          duration: '约 1 小时 50 分',
          fee: '交通约 700-1,250 泰铢',
          transport: 'Grab / 出租车 / 接机',
          notes: 'CZ6063 抵达后办理入境、取行李，前往芭东酒店入住。',
        },
        {
          timeSlot: '傍晚',
          start: '18:00',
          end: '19:30',
          activity: '芭东海滩散步与日落',
          venue: '芭东海滩 (Patong Beach)',
          duration: '约 1.5 小时',
          fee: '免费',
          transport: '步行',
          notes: '在海滩看日落，适应热带气候，附近有很多便利店和餐厅。',
        },
        {
          timeSlot: '晚上',
          start: '20:00',
          end: '23:00',
          activity: '芭东夜市与邦古拉街夜生活',
          venue: '芭东夜市 (Patong Night Market) / 邦古拉街 (Bangla Road)',
          duration: '约 3 小时',
          fee: '夜市小吃约 150-300 泰铢；饮品约 100-250 泰铢',
          transport: '步行 / 嘟嘟车',
          notes: '推荐品尝泰式炒河粉、芒果糯米饭、烤海鲜；邦古拉街体验芭东核心夜生活。',
        },
      ],
    },
    {
      day: 2,
      date: '2026-08-14',
      weekday: '周五',
      area: '普吉镇 (Phuket Old Town)',
      theme: '城市人文深度游',
      schedule: [
        {
          timeSlot: '上午',
          start: '09:30',
          end: '12:30',
          activity: '普吉镇老街漫步',
          venue: '他朗路 (Thalang Road) / 罗曼尼巷 (Soi Romanee)',
          duration: '约 3 小时',
          fee: '免费',
          transport: 'Grab / 双条车（芭东→普吉镇约 400-600 泰铢）',
          notes: '欣赏葡式建筑、彩色骑楼、街头涂鸦，推荐在罗曼尼巷喝咖啡拍照。',
        },
        {
          timeSlot: '中午',
          start: '12:30',
          end: '13:30',
          activity: '普吉镇本地午餐',
          venue: '老街周边餐厅',
          duration: '约 1 小时',
          fee: '约 150-300 泰铢',
          transport: '步行',
          notes: '推荐尝试福建面 (Hokkien Mee)、普吉式米粉 (Mee Ao Gea)、咖喱鸡饭。',
        },
        {
          timeSlot: '下午',
          start: '14:00',
          end: '16:30',
          activity: '泰华博物馆与定光堂',
          venue: '泰华博物馆 (Phuket Thai Hua Museum) / 定光堂',
          duration: '约 2.5 小时',
          fee: '泰华博物馆约 200 泰铢；定光堂免费',
          transport: '步行',
          notes: '了解普吉华人移民史与锡矿文化；定光堂是保存完好的中式宗祠。',
        },
        {
          timeSlot: '晚上',
          start: '17:30',
          end: '21:00',
          activity: '普吉镇周末夜市',
          venue: '普吉镇周末夜市 (Phuket Weekend Night Market / Naka Market)',
          duration: '约 3.5 小时',
          fee: '晚餐约 200-400 泰铢',
          transport: 'Grab / 双条车（返回芭东约 400-600 泰铢）',
          notes: '周五至周日开放，街头美食、手工艺品、 live 演出，体验本地烟火气。',
        },
      ],
    },
    {
      day: 3,
      date: '2026-08-15',
      weekday: '周六',
      area: '卡塔 / 卡伦 / 神仙半岛',
      theme: '西海岸日落线',
      schedule: [
        {
          timeSlot: '上午',
          start: '09:30',
          end: '12:00',
          activity: '卡塔海滩休闲',
          venue: '卡塔海滩 (Kata Beach)',
          duration: '约 2.5 小时',
          fee: '免费（躺椅约 100-200 泰铢）',
          transport: 'Grab / 嘟嘟车（芭东→卡塔约 300-400 泰铢）',
          notes: '海水清澈、沙滩细腻，适合游泳、冲浪或单纯放空。',
        },
        {
          timeSlot: '中午',
          start: '12:00',
          end: '13:30',
          activity: '卡塔海滩午餐',
          venue: '卡塔海滩周边餐厅',
          duration: '约 1.5 小时',
          fee: '约 200-400 泰铢',
          transport: '步行',
          notes: '推荐海鲜餐厅或泰式简餐，避开正对海滩的高价餐厅可更实惠。',
        },
        {
          timeSlot: '下午',
          start: '14:00',
          end: '15:30',
          activity: '卡伦观景台',
          venue: '卡伦观景台 (Karon Viewpoint)',
          duration: '约 1.5 小时',
          fee: '免费',
          transport: 'Grab / 包车（卡塔→观景台约 200-300 泰铢）',
          notes: '俯瞰芭东、卡伦、卡塔三大海湾，是经典摄影点。',
        },
        {
          timeSlot: '傍晚至晚上',
          start: '16:30',
          end: '21:00',
          activity: '神仙半岛日落 + 晚餐',
          venue: '神仙半岛 (Promthep Cape)',
          duration: '约 4.5 小时',
          fee: '免费',
          transport: 'Grab / 包车（观景台→神仙半岛约 250-350 泰铢；返回芭东约 500-700 泰铢）',
          notes: '普吉岛最佳日落观赏点之一；日落前 1 小时抵达占位，晚餐可回卡伦或芭东解决。',
        },
      ],
    },
    {
      day: 4,
      date: '2026-08-16',
      weekday: '周日',
      area: '珊瑚岛 + 返程',
      theme: '离岛轻体验与返程',
      schedule: [
        {
          timeSlot: '上午',
          start: '08:00',
          end: '12:00',
          activity: '珊瑚岛半日游',
          venue: '珊瑚岛 (Coral Island / Ko He)',
          duration: '约 4 小时',
          fee: '半日游套餐约 800-1,500 泰铢（含接送、船票、浮潜设备）',
          transport: '快艇/长尾船（查龙码头出发）',
          notes: '距离普吉本岛近，适合时间短、想体验海岛的游客；可选择浮潜、皮划艇或沙滩放松。',
        },
        {
          timeSlot: '中午',
          start: '12:30',
          end: '14:00',
          activity: '午餐与退房',
          venue: '芭东海滩酒店周边',
          duration: '约 1.5 小时',
          fee: '约 200-400 泰铢',
          transport: '步行',
          notes: '回到酒店退房并午餐，预留充足时间前往机场。',
        },
        {
          timeSlot: '下午',
          start: '14:00',
          end: '16:35',
          activity: '前往机场并返程',
          venue: '普吉国际机场 (HKT)',
          duration: '约 2.5 小时',
          fee: '交通约 700-1,250 泰铢',
          transport: 'Grab / 出租车 / 送机',
          notes: '建议提前 2.5-3 小时抵达机场办理退税、值机与出境手续。',
        },
      ],
    },
  ],
  budgetSummary: {
    perPersonEstimate: {
      food: '约 1,500-2,500 泰铢 / 人 / 4 天',
      localTransport: '约 1,500-2,500 泰铢 / 人 / 4 天',
      activities: '约 1,000-2,000 泰铢 / 人（博物馆、离岛半日游等）',
      shopping: '因人而异',
    },
    notes:
      '以上不含机票与酒店；实际花费取决于餐厅档次、是否参加出海一日游、购物需求等。普吉岛 8 月为雨季尾声，偶有阵雨，不影响大部分行程，但出海前请关注当天海况。',
  },
  tips: [
    '8 月普吉岛气温高、湿度大，建议随身携带防晒霜、驱蚊水与便携雨具。',
    '参观寺庙或宗祠时建议穿着有袖上衣和过膝下装。',
    '夜市现金交易为主，建议携带适量泰铢；部分餐厅和 Grab 可使用信用卡或电子支付。',
    '出海活动建议选择正规旅行社，确认是否含保险与中文向导。',
    '邦古拉街夜生活丰富，但需注意财物安全并适度饮酒。',
  ],
  sources: [
    'Phuket101.net - 普吉岛景点与交通指南',
    'Tourism Authority of Thailand - 官方旅游信息',
    'Google Maps - 车程与景点分布估算',
    '历史航班与交通方案文件：reports/guangzhou-phuket-transport-plan.json',
  ],
  disclaimer:
    '本行程为基于公开信息与常见旅行经验的规划建议，不构成商业服务承诺；实际景点开放、票价、交通时刻请以出行前官方信息为准。',
};

export function escapeHtml(raw) {
  if (raw == null) return '';
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderScheduleRow(item) {
  return `
    <tr>
      <td><strong>${escapeHtml(item.timeSlot)}</strong><br><span class="note">${escapeHtml(item.start)} - ${escapeHtml(item.end)}</span></td>
      <td>
        <div class="activity">${escapeHtml(item.activity)}</div>
        <div class="venue">${escapeHtml(item.venue)}</div>
        <div class="notes">${escapeHtml(item.notes)}</div>
      </td>
      <td>${escapeHtml(item.duration)}</td>
      <td>${escapeHtml(item.fee)}</td>
      <td>${escapeHtml(item.transport)}</td>
    </tr>
  `;
}

function renderDayCard(day) {
  const rows = day.schedule.map(renderScheduleRow).join('');
  return `
    <div class="day-card">
      <div class="day-header">
        <div class="day-title">Day ${day.day} · ${escapeHtml(day.weekday)} · ${escapeHtml(day.date)}</div>
        <div class="day-meta">
          <span class="tag">${escapeHtml(day.area)}</span>
          <span class="tag theme">${escapeHtml(day.theme)}</span>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:16%">时段</th>
            <th style="width:34%">安排</th>
            <th style="width:15%">停留时长</th>
            <th style="width:17%">费用参考</th>
            <th style="width:18%">交通方式</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function renderRouteLogic(data) {
  const themes = data.routeLogic.dailyTheme
    .map(
      (d) => `
      <li>
        <strong>Day ${d.day}（${escapeHtml(d.area)}）</strong>：${escapeHtml(d.theme)}
      </li>
    `
    )
    .join('');

  return `
    <div class="section">
      <h2>整体路线逻辑</h2>
      <p>${escapeHtml(data.routeLogic.summary)}</p>
      <ul>${themes}</ul>
    </div>
  `;
}

function renderBudget(data) {
  const items = data.budgetSummary.perPersonEstimate;
  return `
    <div class="section">
      <h2>人均费用参考（不含机票与酒店）</h2>
      <table>
        <thead>
          <tr>
            <th style="width:22%">项目</th>
            <th>参考费用</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>餐饮</td><td>${escapeHtml(items.food)}</td></tr>
          <tr><td>岛内交通</td><td>${escapeHtml(items.localTransport)}</td></tr>
          <tr><td>景点/活动</td><td>${escapeHtml(items.activities)}</td></tr>
          <tr><td>购物</td><td>${escapeHtml(items.shopping)}</td></tr>
        </tbody>
      </table>
      <p class="note">${escapeHtml(data.budgetSummary.notes)}</p>
    </div>
  `;
}

function renderTips(data) {
  const items = data.tips
    .map((t) => `<li>${escapeHtml(t)}</li>`)
    .join('');
  return `
    <div class="section">
      <h2>实用贴士</h2>
      <ul>${items}</ul>
    </div>
  `;
}

export function buildHtml(data) {
  const dayCards = data.days.map(renderDayCard).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(data.title)}</title>
  <style>
    :root {
      --bg: #f7f9fb;
      --card: #ffffff;
      --primary: #2563eb;
      --text: #1f2937;
      --muted: #6b7280;
      --border: #e5e7eb;
      --accent: #7c3aed;
      --success: #059669;
      --warning: #d97706;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      margin: 0;
      padding: 24px;
    }
    .container {
      max-width: 980px;
      margin: 0 auto;
      background: var(--card);
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
      padding: 32px;
    }
    h1 { margin-top: 0; font-size: 24px; }
    h2 {
      font-size: 18px;
      margin-top: 28px;
      border-bottom: 2px solid var(--border);
      padding-bottom: 8px;
    }
    .meta {
      background: #eff6ff;
      border-left: 4px solid var(--primary);
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 20px;
    }
    .meta p { margin: 4px 0; }
    .tag {
      display: inline-block;
      background: #ede9fe;
      color: var(--accent);
      font-size: 12px;
      padding: 2px 10px;
      border-radius: 12px;
      margin-right: 6px;
    }
    .tag.theme {
      background: #dbeafe;
      color: var(--primary);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 14px;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 12px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #f3f4f6; font-weight: 600; }
    tr:nth-child(even) td { background: #fafafa; }
    .day-card {
      margin-top: 24px;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }
    .day-header {
      background: #f8fafc;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
    }
    .day-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .day-meta { margin-top: 4px; }
    .day-card table { margin: 0; border: none; }
    .day-card th, .day-card td { border-left: none; border-right: none; }
    .day-card tr:last-child td { border-bottom: none; }
    .activity { font-weight: 600; margin-bottom: 4px; }
    .venue { color: var(--muted); font-size: 13px; margin-bottom: 4px; }
    .day-card .notes {
      color: var(--muted);
      font-size: 13px;
      margin-top: 4px;
    }
    .section { margin-top: 28px; }
    .section p { margin: 10px 0; }
    .section ul { margin: 8px 0; padding-left: 22px; }
    .section li { margin: 6px 0; }
    .note { color: var(--muted); font-size: 13px; }
    .highlight { color: var(--warning); font-weight: 600; }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      font-size: 12px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(data.title)}</h1>

    <div class="meta">
      <p><span class="tag">行程假设</span>${escapeHtml(data.trip.dates.duration)}，${escapeHtml(data.trip.dates.start)} 至 ${escapeHtml(data.trip.dates.end)}，${escapeHtml(data.trip.origin)}往返${escapeHtml(data.trip.destination)}。</p>
      <p><span class="tag">偏好</span>${escapeHtml(data.trip.preferences.join(' + '))}</p>
      <p><span class="tag">住宿建议</span>${escapeHtml(data.trip.accommodation)}</p>
    </div>

    ${renderRouteLogic(data)}

    <div class="section">
      <h2>每日行程安排</h2>
      ${dayCards}
    </div>

    ${renderBudget(data)}

    ${renderTips(data)}

    <div class="footer">
      <p><strong>数据来源：</strong>${data.sources.map(escapeHtml).join('、')}。</p>
      <p>${escapeHtml(data.disclaimer)}</p>
    </div>
  </div>
</body>
</html>`;
}

export function generateItinerary(options = {}) {
  const html = buildHtml(TRIP_DATA);
  const jsonPath = options.jsonPath || join(REPORTS_DIR, 'phuket-itinerary.json');
  const htmlPath = options.htmlPath || join(REPORTS_DIR, 'phuket-itinerary.html');

  writeFileSync(jsonPath, JSON.stringify(TRIP_DATA, null, 2), 'utf8');
  writeFileSync(htmlPath, html, 'utf8');

  const result = {
    jsonPath,
    htmlPath,
    htmlLength: html.length,
    days: TRIP_DATA.days.length,
    activities: TRIP_DATA.days.reduce((sum, d) => sum + d.schedule.length, 0),
  };

  if (!options.silent) {
    console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL('gen-phuket-itinerary.mjs', 'file://' + process.argv[1].replace(/\\/g, '/')).href;
if (isMain) {
  generateItinerary();
}
