import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadJson(path) {
  const fullPath = join(PROJECT_ROOT, path);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing required input file: ${path}`);
  }
  return JSON.parse(readFileSync(fullPath, 'utf8'));
}

function renderMeta(trip, preferences) {
  const dates = trip.dates || trip.exampleDates || {};
  const start = dates.start || dates.outbound || '2026-08-13';
  const end = dates.end || dates.return || '2026-08-16';
  const duration = dates.duration || '4天3夜';
  const origin = trip.origin || '广州';
  const destination = trip.destination || '普吉岛 (Phuket, Thailand)';

  return `
    <div class="meta">
      <p><span class="tag">行程</span>${escapeHtml(origin)} 往返 ${escapeHtml(destination)}，${escapeHtml(duration)}，${escapeHtml(start)} 至 ${escapeHtml(end)}。</p>
      ${preferences ? `<p><span class="tag">偏好</span>${escapeHtml(preferences.join(' + '))}</p>` : ''}
      <p><span class="tag">输出说明</span>桌面友好单文件 HTML，整合交通、行程、住宿、餐饮、预算与贴士。</p>
    </div>
  `;
}

function renderTransport(transport) {
  const { trip, routes, options, visa, baggage, localTransport, budgetTips } = transport;
  const exampleDates = trip.exampleDates || {};

  let rows = '';
  for (const opt of options) {
    const outbound = opt.outbound.flight
      ? `${escapeHtml(opt.outbound.flight)}<br>${escapeHtml(opt.outbound.dep)} → ${escapeHtml(opt.outbound.arr)}<br><span class="note">${escapeHtml(opt.outbound.frequency)}</span>`
      : `${escapeHtml(opt.outbound.route)}<br><span class="note">${escapeHtml(opt.outbound.frequency || '')}</span>`;
    const ret = opt.return.flight
      ? `${escapeHtml(opt.return.flight)}<br>${escapeHtml(opt.return.dep)} → ${escapeHtml(opt.return.arr)}<br><span class="note">${escapeHtml(opt.return.frequency || '')}</span>`
      : `${escapeHtml(opt.return.route || '')}`;
    rows += `
      <tr>
        <td><strong>${escapeHtml(opt.id)}. ${escapeHtml(opt.name)}</strong><br>${escapeHtml(opt.airline)}</td>
        <td>${outbound}</td>
        <td>${ret}</td>
        <td>${escapeHtml(opt.duration)}</td>
        <td class="price">¥${opt.priceRangeCny.min} - ${opt.priceRangeCny.max}</td>
        <td>${escapeHtml(opt.remarks)}</td>
      </tr>
    `;
  }

  let baggageList = '';
  for (const b of baggage) {
    baggageList += `<li><strong>${escapeHtml(b.airline)}：</strong>托运 ${escapeHtml(b.checked)}；随身 ${escapeHtml(b.carryOn)}。</li>`;
  }

  let airportTransportList = '';
  for (const t of localTransport.airportToPatong) {
    airportTransportList += `<li><strong>${escapeHtml(t.mode)}：</strong>约 ${escapeHtml(t.priceThb)} 泰铢；${escapeHtml(t.note)}。</li>`;
  }

  return `
    <div class="section">
      <h2>一、交通方案</h2>
      <p>航线概览：广州白云机场 (CAN) 往返普吉国际机场 (HKT)，直线距离约 ${routes.distanceKm} 公里；直飞约 ${routes.directFlightTime}；${routes.timeDifference}。</p>
      <table>
        <thead>
          <tr>
            <th style="width:14%">方案</th>
            <th style="width:20%">去程（${escapeHtml(exampleDates.outbound || '8月13日')}）</th>
            <th style="width:20%">返程（${escapeHtml(exampleDates.return || '8月16日')}）</th>
            <th style="width:10%">飞行时长</th>
            <th style="width:16%">参考价（人/往返含税）</th>
            <th style="width:20%">备注</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <h3>入境与签证</h3>
      <ul>
        <li><strong>${escapeHtml(visa.currentPolicy)}：</strong>${escapeHtml(visa.detail)}</li>
        <li><strong>泰国电子入境卡（TDAC）：</strong>${escapeHtml(visa.tdac)}</li>
        <li><strong>抽查材料：</strong>${visa.documents.map(escapeHtml).join('；')}。</li>
        <li><strong>落地签备选：</strong>若政策临时调整，可办理落地签，停留 ${escapeHtml(visa.voaFallback.stay)}，费用 ${escapeHtml(visa.voaFallback.feeThb)} 泰铢。</li>
      </ul>

      <h3>行李额参考</h3>
      <ul>${baggageList}</ul>

      <h3>普吉岛当地交通</h3>
      <ul>
        <li><strong>机场 → 芭东海滩：</strong>
          <ul>${airportTransportList}</ul>
        </li>
        <li><strong>岛内出行：</strong>${escapeHtml(localTransport.island)}</li>
      </ul>

      <h3>交通预算提醒</h3>
      <ul>
        <li>签证：${escapeHtml(budgetTips.visa)}。</li>
        <li>旅游保险：${escapeHtml(budgetTips.insurance)}。</li>
        <li>当地交通：${escapeHtml(budgetTips.localTransport)}。</li>
      </ul>
    </div>
  `;
}

function renderItinerary(itinerary) {
  const { routeLogic, days, budgetSummary, tips } = itinerary;

  let themes = '';
  for (const t of routeLogic.dailyTheme) {
    themes += `<li><strong>Day ${t.day}（${escapeHtml(t.area)}）</strong>：${escapeHtml(t.theme)}</li>`;
  }

  let dayCards = '';
  for (const day of days) {
    let rows = '';
    for (const item of day.schedule) {
      rows += `
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

    dayCards += `
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
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  const budgetRows = Object.entries(budgetSummary.perPersonEstimate)
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join('');

  const tipItems = tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('');

  return `
    <div class="section">
      <h2>二、每日行程安排</h2>
      <p>${escapeHtml(routeLogic.summary)}</p>
      <ul>${themes}</ul>
      ${dayCards}
    </div>

    <div class="section">
      <h2>三、行程费用参考（不含机票与酒店）</h2>
      <table>
        <thead><tr><th style="width:22%">项目</th><th>参考费用</th></tr></thead>
        <tbody>${budgetRows}</tbody>
      </table>
      <p class="note">${escapeHtml(budgetSummary.notes)}</p>
    </div>

    <div class="section">
      <h2>四、行程贴士</h2>
      <ul>${tipItems}</ul>
    </div>
  `;
}

function renderAccommodation(accommodation) {
  const thead = accommodation.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const tbody = accommodation.options
    .map((opt) => {
      const cells = accommodation.columns
        .map((c) => {
          const value = opt[c.key];
          if (c.key === 'tier') {
            const tierClass = value === '经济' ? 'eco' : value === '舒适' ? 'std' : 'pre';
            return `<td><span class="tier ${tierClass}">${escapeHtml(value)}</span></td>`;
          }
          return `<td>${escapeHtml(value)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `
    <div class="section">
      <h2>五、住宿建议</h2>
      <p>${escapeHtml(accommodation.intro)}</p>
      <table>
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

function renderDining(dining) {
  const thead = dining.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const tbody = dining.categories
    .map((cat) => {
      const cells = dining.columns
        .map((c) => {
          const value = cat[c.key];
          if (c.key === 'mustTry') {
            return `<td>${Array.isArray(value) ? value.map(escapeHtml).join('、') : escapeHtml(value)}</td>`;
          }
          return `<td>${escapeHtml(value)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `
    <div class="section">
      <h2>六、餐饮推荐</h2>
      <p>${escapeHtml(dining.intro)}</p>
      <table>
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

function renderBudget(budget) {
  const thead = budget.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const tbody = budget.items
    .map((item) => {
      const cells = budget.columns
        .map((c) => `<td>${escapeHtml(item[c.key])}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const totalCells = budget.columns
    .map((c) => {
      if (c.key === 'item') return '<td><strong>合计（预估）</strong></td>';
      if (c.key === 'notes') return `<td>${escapeHtml(budget.notes)}</td>`;
      return `<td class="price">${escapeHtml(budget.total[c.key])}</td>`;
    })
    .join('');

  return `
    <div class="section">
      <h2>七、预算明细</h2>
      <p>${escapeHtml(budget.intro)}</p>
      <table>
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}<tr class="total">${totalCells}</tr></tbody>
      </table>
    </div>
  `;
}

function renderTips(tips) {
  const blocks = tips.categories
    .map((cat) => {
      const items = cat.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('');
      return `
        <div class="tip-block">
          <h3>${escapeHtml(cat.title)}</h3>
          <ul>${items}</ul>
        </div>
      `;
    })
    .join('');

  return `
    <div class="section">
      <h2>八、实用贴士清单</h2>
      <p>${escapeHtml(tips.intro)}</p>
      ${blocks}
    </div>
  `;
}

function renderSourcesAndDisclaimer(transport, itinerary, practical) {
  const sources = [
    ...(transport.sources || []),
    ...(itinerary.sources || []),
    ...(practical.sources || []),
  ];
  const uniqueSources = [...new Set(sources)].map(escapeHtml).join('、');

  return `
    <div class="footer">
      <p><strong>数据来源：</strong>${uniqueSources}。</p>
      <p>${escapeHtml(transport.disclaimer || '')} ${escapeHtml(itinerary.disclaimer || '')} ${escapeHtml(practical.disclaimer || '')}</p>
    </div>
  `;
}

export function buildHtml(guide) {
  const { title, trip, preferences, transport, itinerary, practical } = guide;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
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
    h3 {
      font-size: 15px;
      margin: 18px 0 8px;
      color: var(--primary);
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
      background: #dbeafe;
      color: var(--primary);
      font-size: 12px;
      padding: 2px 10px;
      border-radius: 12px;
      margin-right: 6px;
    }
    .tag.theme {
      background: #ede9fe;
      color: var(--accent);
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
    tr.total td { background: #eff6ff; font-weight: 600; }
    .price { color: var(--success); font-weight: 600; }
    .note { color: var(--muted); font-size: 13px; }
    .section { margin-top: 28px; }
    .section p { margin: 10px 0; }
    .section ul { margin: 8px 0; padding-left: 22px; }
    .section li { margin: 6px 0; }
    .tier {
      display: inline-block;
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 600;
    }
    .tier.eco { background: #dcfce7; color: #166534; }
    .tier.std { background: #dbeafe; color: #1e40af; }
    .tier.pre { background: #f3e8ff; color: #6b21a8; }
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
    .tip-block {
      margin-top: 16px;
      padding: 12px 16px;
      background: #fafafa;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .tip-block h3 { margin-top: 0; }
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
    <h1>${escapeHtml(title)}</h1>
    ${renderMeta(trip, preferences)}
    ${renderTransport(transport)}
    ${renderItinerary(itinerary)}
    ${renderAccommodation(practical.accommodation)}
    ${renderDining(practical.dining)}
    ${renderBudget(practical.budget)}
    ${renderTips(practical.tips)}
    ${renderSourcesAndDisclaimer(transport, itinerary, practical)}
  </div>
</body>
</html>`;
}

export function buildGuideData() {
  const transport = loadJson('reports/guangzhou-phuket-transport-plan.json');
  const itinerary = loadJson('reports/phuket-itinerary.json');
  const practical = loadJson('reports/phuket-practical.json');

  const trip = {
    origin: '广州',
    destination: '普吉岛 (Phuket, Thailand)',
    dates: {
      start: '2026-08-13',
      end: '2026-08-16',
      duration: '4天3夜',
    },
  };

  return {
    title: '广州 → 普吉岛 · 4 天 3 夜完整旅游攻略',
    trip,
    preferences: ['城市人文', '夜生活'],
    transport,
    itinerary,
    practical,
  };
}

export function generateGuide({
  jsonPath = 'reports/guangzhou-phuket-travel-guide.json',
  htmlPath = 'reports/guangzhou-phuket-travel-guide.html',
  silent = false,
} = {}) {
  const guide = buildGuideData();
  const html = buildHtml(guide);

  const fullJsonPath = isAbsolute(jsonPath) ? jsonPath : join(PROJECT_ROOT, jsonPath);
  const fullHtmlPath = isAbsolute(htmlPath) ? htmlPath : join(PROJECT_ROOT, htmlPath);

  writeFileSync(fullJsonPath, JSON.stringify(guide, null, 2), 'utf8');
  writeFileSync(fullHtmlPath, html, 'utf8');

  const result = {
    jsonPath: fullJsonPath,
    htmlPath: fullHtmlPath,
    htmlLength: html.length,
    sections: 8,
  };

  if (!silent) {
    console.log(`Generated guide:`);
    console.log(`  JSON: ${result.jsonPath}`);
    console.log(`  HTML: ${result.htmlPath}`);
    console.log(`  HTML length: ${result.htmlLength} bytes`);
  }

  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateGuide();
}
