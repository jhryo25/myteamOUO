#!/usr/bin/env node
/**
 * 生成普吉岛 4 天 3 夜住宿、餐饮、预算与实用贴士
 * 输出：reports/phuket-practical.html（可直接浏览器打开）
 *       reports/phuket-practical.json（结构化数据）
 *
 * 设计要点：
 *   - 按海滩区域给出 3 档住宿建议（经济/舒适/高端）。
 *   - 按美食类型给出餐厅/夜市建议，标注价位与必尝菜。
 *   - 汇总“机票+住宿+餐饮+活动+当地交通”三档总预算。
 *   - 整理必备物品、网络、换汇、安全、语言等落地贴士。
 *   - 单文件 HTML，桌面友好，与交通/行程方案视觉风格保持一致。
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { escapeHtml } from './gen-phuket-itinerary.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORTS_DIR = join(ROOT, 'reports');

export const PRACTICAL_DATA = {
  title: '普吉岛 4 天 3 夜 · 住宿、餐饮、预算与实用贴士',
  trip: {
    origin: '广州',
    destination: '普吉岛 (Phuket, Thailand)',
    dates: {
      start: '2026-08-13',
      end: '2026-08-16',
      duration: '4天3夜',
    },
  },
  openQuestions: [
    {
      question: '人均预算范围未确定',
      handling:
        '按经济/舒适/高端三档分别给出住宿与总预算参考，用户可结合自身预算灵活替换。',
    },
    {
      question: '饮食禁忌或偏好未说明',
      handling:
        '默认无特殊禁忌，推荐以泰式海鲜、街头小吃、泰南菜为主，并标注常见过敏原提示。',
    },
    {
      question: '出行年份未明确',
      handling:
        '按 2026 年 8 月 13-16 日示例输出，价格与政策请以实际出行时为准。',
    },
  ],
  accommodation: {
    intro:
      '建议根据行程偏好选择住宿区域：想要夜生活和便利选芭东；偏好安静海滩选卡塔/卡伦；喜欢人文与省钱选普吉镇。以下按区域和价位给出参考，不指定具体房号/实时库存。',
    columns: [
      { key: 'area', label: '区域' },
      { key: 'tier', label: '档位' },
      { key: 'example', label: '参考类型' },
      { key: 'price', label: '参考价（CNY/晚）' },
      { key: 'pros', label: '优点' },
      { key: 'cons', label: '缺点' },
      { key: 'suitable', label: '适合人群' },
      { key: 'notes', label: '备注' },
    ],
    options: [
      {
        area: '芭东海滩 (Patong)',
        tier: '经济',
        example: '背包客栈 / 小型精品旅舍',
        price: '120 - 250',
        pros: '夜生活、便利店、餐厅密集；交通最方便',
        cons: '夜晚嘈杂；沙滩人较多',
        suitable: '预算有限、喜欢热闹的年轻人',
        notes: '避开临街低楼层可减少噪音',
      },
      {
        area: '芭东海滩 (Patong)',
        tier: '舒适',
        example: '四星级度假酒店 / 公寓式酒店',
        price: '350 - 650',
        pros: '设施齐全；多数带泳池；步行可达海滩与夜市',
        cons: '旺季价格上涨明显',
        suitable: '情侣、朋友结伴、首次到访',
        notes: '建议提前 2-4 周预订锁定价格',
      },
      {
        area: '芭东海滩 (Patong)',
        tier: '高端',
        example: '国际五星 / 海滩度假别墅',
        price: '900 - 2,000+',
        pros: '私人沙滩/无边泳池/SPA；服务完善',
        cons: '价格高；部分酒店距闹市较远',
        suitable: '家庭、蜜月、追求度假体验',
        notes: '注意是否含早餐与机场接送',
      },
      {
        area: '卡塔/卡伦海滩 (Kata/Karon)',
        tier: '经济',
        example: '家庭旅馆 / 海滨简易民宿',
        price: '100 - 220',
        pros: '沙滩质量较好；生活成本低于芭东',
        cons: '夜间娱乐较少；去普吉镇/机场略远',
        suitable: '冲浪爱好者、安静度假',
        notes: '卡塔冲浪学校较多',
      },
      {
        area: '卡塔/卡伦海滩 (Kata/Karon)',
        tier: '舒适',
        example: '沙滩度假酒店 / 泳池别墅',
        price: '400 - 800',
        pros: '亲子友好；海水清澈；餐厅选择多',
        cons: '旺季海滩人流上升',
        suitable: '家庭、亲子、慢节奏游客',
        notes: '卡伦海滩长度大，注意酒店具体位置',
      },
      {
        area: '卡塔/卡伦海滩 (Kata/Karon)',
        tier: '高端',
        example: '悬崖海景度假村 / 高端 SPA 酒店',
        price: '1,000 - 2,500+',
        pros: '景观绝佳；私密性强',
        cons: '出入依赖打车；部分餐饮价格较高',
        suitable: '蜜月、摄影、高端度假',
        notes: '日落/海景房型溢价明显',
      },
      {
        area: '普吉镇 (Phuket Old Town)',
        tier: '经济',
        example: '老街民宿 / 青年旅舍',
        price: '80 - 180',
        pros: '便宜；葡式建筑与老街上镜；夜市/本地餐厅多',
        cons: '无海滩；去海边需打车',
        suitable: '背包客、人文摄影爱好者',
        notes: '周末夜市人多，住附近方便',
      },
      {
        area: '普吉镇 (Phuket Old Town)',
        tier: '舒适',
        example: '精品酒店 / 设计民宿',
        price: '280 - 550',
        pros: '人文氛围浓；餐饮地道；性价比高于海滩区',
        cons: '白天较热；去海滩单程约 30-45 分钟',
        suitable: '喜欢老街、博物馆、夜市美食的游客',
        notes: '建议选择带天台或庭院的房源',
      },
      {
        area: '普吉镇 (Phuket Old Town)',
        tier: '高端',
        example: '历史建筑改造精品酒店',
        price: '700 - 1,500',
        pros: '独特文化体验；设计感强；服务个性化',
        cons: '无泳池/海景；位置偏离海滩',
        suitable: '文化深度游、追求特色住宿',
        notes: '预订前确认是否有电梯与停车位',
      },
    ],
  },
  dining: {
    intro:
      '普吉岛饮食以泰南风味为主，酸辣开胃、海鲜丰富。以下按类型推荐，兼顾夜市烟火气与正式餐厅，费用为 2026 年 8 月参考价。',
    columns: [
      { key: 'category', label: '类型' },
      { key: 'mustTry', label: '必尝推荐' },
      { key: 'venues', label: '推荐去处' },
      { key: 'avgPrice', label: '人均参考' },
      { key: 'notes', label: '贴士' },
    ],
    categories: [
      {
        category: '海鲜大排档',
        mustTry: ['椒盐皮皮虾', '蒜蓉龙虾', '泰式炒花蛤', '冬阴功海鲜汤'],
        venues: '芭东班赞海鲜市场 (Banzaan)、拉威海鲜市场 (Rawai)',
        avgPrice: 'THB 400 - 800（含加工费）',
        notes: '市场买海鲜后二楼加工，记得议价并确认加工费按重量还是按菜。',
      },
      {
        category: '街头夜市',
        mustTry: ['泰式炒河粉 (Pad Thai)', '芒果糯米饭', '椰子冰淇淋', '烤鸡肉串'],
        venues: '芭东夜市、普吉镇周末夜市 (Naka Market)、Chillva 夜市',
        avgPrice: 'THB 150 - 300',
        notes: '夜市现金交易为主；肠胃敏感者避免生腌与生冰。',
      },
      {
        category: '泰南本地菜',
        mustTry: ['普吉福建面 (Hokkien Mee)', 'Mee Ao Gea', 'Massaman 咖喱', '泰南酸辣汤'],
        venues: '普吉镇老街周边、Mee Ao Gea 专卖店、本地 family-run 餐厅',
        avgPrice: 'THB 100 - 250',
        notes: '泰南菜偏辣，点餐时可说明“少辣”(pet nit noi)。',
      },
      {
        category: '西餐 & 咖啡馆',
        mustTry: ['Brunch 拼盘', '意式咖啡', '汉堡', '牛排'],
        venues: '卡塔/卡伦海滩沿街、普吉镇罗曼尼巷 (Soi Romanee)',
        avgPrice: 'THB 250 - 500',
        notes: '适合午餐歇脚；部分餐厅收取 7% 增值税与 10% 服务费。',
      },
      {
        category: '甜品 & 水果',
        mustTry: ['芒果糯米饭', '椰子冰淇淋', '泰式奶茶', '榴莲/山竹'],
        venues: '夜市、7-11、街头水果摊',
        avgPrice: 'THB 40 - 120',
        notes: '8 月榴莲季尾声，价格仍较实惠；酒店内一般禁止带入榴莲。',
      },
    ],
  },
  budget: {
    intro:
      '以下为“每人 4 天 3 夜”预估总费用，按经济/舒适/高端三档拆分，已包含机票、住宿、餐饮、活动与当地交通。不含购物与个人额外消费。',
    notes:
      '汇率按 1 CNY ≈ 4.8 THB 估算；实际价格受促销、淡旺季、预订时间影响。机票参考区间来自 `reports/guangzhou-phuket-transport-plan.html`。',
    columns: [
      { key: 'item', label: '费用项目' },
      { key: 'notes', label: '说明' },
      { key: 'economy', label: '经济档' },
      { key: 'standard', label: '舒适档' },
      { key: 'premium', label: '高端档' },
    ],
    items: [
      {
        item: '往返机票',
        notes: '广州-普吉，含税；直飞/转机均有',
        economy: '¥1,200 - 2,000',
        standard: '¥2,500 - 3,500',
        premium: '¥3,500 - 5,500',
      },
      {
        item: '住宿（3 晚）',
        notes: '按推荐区域对应档位均价×3',
        economy: '¥360 - 750',
        standard: '¥1,050 - 2,400',
        premium: '¥2,700 - 7,500+',
      },
      {
        item: '餐饮',
        notes: '4 天早中晚餐+饮品/小吃',
        economy: '¥300 - 500',
        standard: '¥600 - 1,000',
        premium: '¥1,200 - 2,500',
      },
      {
        item: '活动与门票',
        notes: '博物馆、离岛半日游、日落点等',
        economy: '¥200 - 400',
        standard: '¥400 - 800',
        premium: '¥800 - 1,800',
      },
      {
        item: '当地交通',
        notes: '机场接送 + 岛内 Grab/嘟嘟车/双条车',
        economy: '¥250 - 450',
        standard: '¥400 - 700',
        premium: '¥700 - 1,200',
      },
      {
        item: '签证 & 保险',
        notes: '免签约 ¥0；保险 ¥30-100/人',
        economy: '¥30 - 100',
        standard: '¥50 - 150',
        premium: '¥100 - 300',
      },
    ],
    total: {
      economy: '约 ¥2,340 - 4,200/人',
      standard: '约 ¥5,000 - 8,550/人',
      premium: '约 ¥9,000 - 18,800+/人',
    },
  },
  tips: {
    intro: '落地后可直接执行的生活信息清单，按主题分类。',
    categories: [
      {
        title: '必备物品',
        items: [
          '防晒霜 SPF50+、太阳镜、遮阳帽：热带紫外线强，海边更易晒伤。',
          '驱蚊水/止痒膏：雨季蚊虫较多，夜市与绿植区尤其需要。',
          '轻便雨具：8 月为雨季尾声，午后偶有阵雨，建议带折叠伞或轻便雨衣。',
          '泳衣、沙滩鞋、速干毛巾：离岛与海滩活动必备。',
          '常用药：肠胃药、晕车/船药、创可贴、个人处方药。',
          '充电宝与转换插头：泰国插座多为两扁孔（A/C 型），多数国内两孔插头可直接使用；三孔设备需转换器。',
        ],
      },
      {
        title: '网络 & 通讯',
        items: [
          '落地买 SIM 卡：机场柜台或 7-11 可购 AIS/DTAC/TrueMove 旅游套餐，约 THB 150-300/7 天含流量。',
          '国内提前租 Wi-Fi 蛋：适合多人共享，机场自提。',
          '下载 App：Grab（打车/外卖）、Google Maps、Bolt（部分区域更便宜）、翻译软件。',
          '酒店 Wi-Fi 一般免费，但离岛/偏远区域信号弱。',
        ],
      },
      {
        title: '换汇 & 支付',
        items: [
          '国内提前预约兑换少量泰铢现金（THB 10,000-15,000/人），用于夜市、小摊、打车。',
          '普吉 ATM 取现方便，但单笔手续费约 THB 220，建议一次性取足。',
          '部分餐厅、7-11、大型商场支持支付宝/微信/信用卡；小摊与夜市多用现金。',
          '泰国入境可能抽查现金：个人 ≥10,000 泰铢或等值外币，家庭 ≥20,000 泰铢。',
        ],
      },
      {
        title: '安全 & 健康',
        items: [
          '出海前查看天气与海况，雨季避免乘坐超载船只；务必穿救生衣。',
          '租摩托车需国际驾照/泰国驾照，佩戴头盔；无经验者不建议自驾，山路多且当地车速快。',
          '夜间在邦古拉街等热闹区域注意财物安全，避免过度饮酒。',
          '海边游玩注意旗帜警示：红旗表示禁止下水；离岸流风险不可忽视。',
          '饮食注意生腌海鲜与冰块卫生，备好肠胃药。',
        ],
      },
      {
        title: '语言 & 礼仪',
        items: [
          '旅游区英语通行，简单中文在部分店铺也能沟通；备好翻译 App 更稳妥。',
          '基本礼貌用语：Sa-wat-dee（你好/再见）、Khop khun（谢谢）、Mai pet（不要辣）。',
          '参观寺庙或宗祠需穿着有袖上衣与过膝下装；进入室内通常需脱鞋。',
          '给小费非强制，但服务态度好可留 THB 20-100；勿给硬币作为小费。',
        ],
      },
      {
        title: '天气 & 穿着',
        items: [
          '8 月普吉岛气温约 25-32℃，湿度高，建议穿透气的棉麻衣物。',
          '室内外温差大（空调较冷），可带一件薄外套。',
          '寺庙与正式餐厅不宜穿背心、短裤、拖鞋。',
        ],
      },
    ],
  },
  sources: [
    'Phuket101.net - 住宿与餐饮指南',
    'Tourism Authority of Thailand - 官方旅游信息',
    'Google Maps - 区域与交通估算',
    '历史交通方案文件：reports/guangzhou-phuket-transport-plan.html',
    '常见旅行经验与 2024-2025 年价格参考',
  ],
  disclaimer:
    '本页面为基于公开信息与常见旅行经验的整理建议，不构成商业服务承诺；实际酒店价格、餐厅营业、汇率与入境政策请以出行前官方信息为准。',
};

function renderOpenQuestions(data) {
  const items = data.openQuestions
    .map(
      (q) => `
      <li>
        <strong>${escapeHtml(q.question)}</strong>：${escapeHtml(q.handling)}
      </li>
    `
    )
    .join('');
  return `
    <div class="meta">
      <p><span class="tag">未澄清问题处理</span></p>
      <ul>${items}</ul>
    </div>
  `;
}

function renderAccommodation(data) {
  const { columns, options } = data.accommodation;
  const header = columns
    .map((col) => `<th>${escapeHtml(col.label)}</th>`)
    .join('');
  const rows = options
    .map(
      (opt) => `
      <tr>
        ${columns
          .map((col) => {
            const value = opt[col.key];
            if (col.key === 'tier') {
              return `<td><span class="tier ${escapeHtml(value) === '经济' ? 'eco' : escapeHtml(value) === '舒适' ? 'std' : 'pre'}">${escapeHtml(value)}</span></td>`;
            }
            return `<td>${escapeHtml(value)}</td>`;
          })
          .join('')}
      </tr>
    `
    )
    .join('');

  return `
    <div class="section">
      <h2>一、住宿建议</h2>
      <p>${escapeHtml(data.accommodation.intro)}</p>
      <table>
        <thead><tr>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderDining(data) {
  const { columns, categories } = data.dining;
  const header = columns
    .map((col) => `<th>${escapeHtml(col.label)}</th>`)
    .join('');
  const rows = categories
    .map(
      (cat) => `
      <tr>
        ${columns
          .map((col) => {
            const value = cat[col.key];
            if (col.key === 'mustTry' && Array.isArray(value)) {
              return `<td>${escapeHtml(value.join('、'))}</td>`;
            }
            return `<td>${escapeHtml(value)}</td>`;
          })
          .join('')}
      </tr>
    `
    )
    .join('');

  return `
    <div class="section">
      <h2>二、餐饮推荐</h2>
      <p>${escapeHtml(data.dining.intro)}</p>
      <table>
        <thead><tr>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderBudget(data) {
  const { columns, items, total } = data.budget;
  const header = columns
    .map((col) => `<th>${escapeHtml(col.label)}</th>`)
    .join('');
  const rows = items
    .map(
      (item) => `
      <tr>
        ${columns
          .map((col) => `<td>${escapeHtml(item[col.key])}</td>`)
          .join('')}
      </tr>
    `
    )
    .join('');
  const totalRow = `
    <tr class="total">
      <td><strong>合计（预估）</strong></td>
      <td>${escapeHtml(data.budget.notes)}</td>
      <td class="price">${escapeHtml(total.economy)}</td>
      <td class="price">${escapeHtml(total.standard)}</td>
      <td class="price">${escapeHtml(total.premium)}</td>
    </tr>
  `;

  return `
    <div class="section">
      <h2>三、预算明细</h2>
      <p>${escapeHtml(data.budget.intro)}</p>
      <table>
        <thead><tr>${header}</tr></thead>
        <tbody>${rows}${totalRow}</tbody>
      </table>
      <p class="note">${escapeHtml(data.budget.notes)}</p>
    </div>
  `;
}

function renderTips(data) {
  const sections = data.tips.categories
    .map(
      (cat) => `
      <div class="tip-block">
        <h3>${escapeHtml(cat.title)}</h3>
        <ul>
          ${cat.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </div>
    `
    )
    .join('');

  return `
    <div class="section">
      <h2>四、实用贴士清单</h2>
      <p>${escapeHtml(data.tips.intro)}</p>
      ${sections}
    </div>
  `;
}

export function buildHtml(data) {
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
      --success: #059669;
      --warning: #d97706;
      --accent: #7c3aed;
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
    .meta ul { margin: 8px 0; padding-left: 22px; }
    .meta li { margin: 6px 0; }
    .tag {
      display: inline-block;
      background: #dbeafe;
      color: var(--primary);
      font-size: 12px;
      padding: 2px 10px;
      border-radius: 12px;
      margin-right: 6px;
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
    .section { margin-top: 24px; }
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
    .tip-block {
      margin-top: 16px;
      padding: 12px 16px;
      background: #fafafa;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .tip-block h3 { margin-top: 0; }
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
    </div>

    ${renderOpenQuestions(data)}
    ${renderAccommodation(data)}
    ${renderDining(data)}
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

export function generatePractical(options = {}) {
  const html = buildHtml(PRACTICAL_DATA);
  const jsonPath = options.jsonPath || join(REPORTS_DIR, 'phuket-practical.json');
  const htmlPath = options.htmlPath || join(REPORTS_DIR, 'phuket-practical.html');

  writeFileSync(jsonPath, JSON.stringify(PRACTICAL_DATA, null, 2), 'utf8');
  writeFileSync(htmlPath, html, 'utf8');

  const result = {
    jsonPath,
    htmlPath,
    htmlLength: html.length,
    accommodationOptions: PRACTICAL_DATA.accommodation.options.length,
    diningCategories: PRACTICAL_DATA.dining.categories.length,
    budgetItems: PRACTICAL_DATA.budget.items.length,
    tipCategories: PRACTICAL_DATA.tips.categories.length,
  };

  if (!options.silent) {
    console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL('gen-phuket-practical.mjs', 'file://' + process.argv[1].replace(/\\/g, '/')).href;
if (isMain) {
  generatePractical();
}
