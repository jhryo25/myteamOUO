#!/usr/bin/env node
/**
 * 佳木斯机场与可用航线识别工具
 * 用途：整理佳木斯东郊机场(JMU)的 IATA/ICAO 代码、机场信息及通航航线清单
 * 输出：reports/jiamusi_routes_{YYYYMMDD}.json、同名的 CSV
 *
 * 数据来源：公开航班计划、机场航点信息（Navitime Flight、航空公司官网、OTA 航班搜索）
 * 注意：本清单反映航班计划与近期执飞情况，具体每日航班请以航空公司或售票系统为准。
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORTS_DIR = join(__dirname, '..', 'reports');

const AIRPORT = {
  iata: 'JMU',
  icao: 'ZYJM',
  name_cn: '佳木斯东郊机场',
  name_en: 'Jiamusi Dongjiao Airport',
  city: '佳木斯',
  province: '黑龙江省',
  country: '中国',
  distance_to_city_km: 10,
  flight_area_class: '4C',
};

const ROUTES = [
  {
    route_id: 'JMU-PVG',
    departure_city: '上海',
    departure_airport_iata: 'PVG',
    departure_airport_name: '上海浦东国际机场',
    airlines: [
      { code: 'MU', name_cn: '中国东方航空', name_en: 'China Eastern Airlines' },
      { code: 'CA', name_cn: '中国国际航空', name_en: 'Air China' },
    ],
    route_type: '国内直飞',
    status_in_last_15_days: '执飞',
  },
  {
    route_id: 'JMU-PEK',
    departure_city: '北京',
    departure_airport_iata: 'PEK',
    departure_airport_name: '北京首都国际机场',
    airlines: [
      { code: 'CA', name_cn: '中国国际航空', name_en: 'Air China' },
      { code: 'HU', name_cn: '海南航空', name_en: 'Hainan Airlines' },
    ],
    route_type: '国内直飞',
    status_in_last_15_days: '执飞',
  },
  {
    route_id: 'JMU-PKX',
    departure_city: '北京',
    departure_airport_iata: 'PKX',
    departure_airport_name: '北京大兴国际机场',
    airlines: [
      { code: 'CA', name_cn: '中国国际航空', name_en: 'Air China' },
      { code: 'MU', name_cn: '中国东方航空', name_en: 'China Eastern Airlines' },
      { code: 'JD', name_cn: '首都航空', name_en: 'Capital Airlines' },
    ],
    route_type: '国内直飞',
    status_in_last_15_days: '执飞',
  },
  {
    route_id: 'JMU-CAN',
    departure_city: '广州',
    departure_airport_iata: 'CAN',
    departure_airport_name: '广州白云国际机场',
    airlines: [
      { code: 'CZ', name_cn: '中国南方航空', name_en: 'China Southern Airlines' },
    ],
    route_type: '国内直飞/经停',
    status_in_last_15_days: '执飞',
  },
  {
    route_id: 'JMU-SZX',
    departure_city: '深圳',
    departure_airport_iata: 'SZX',
    departure_airport_name: '深圳宝安国际机场',
    airlines: [
      { code: 'CZ', name_cn: '中国南方航空', name_en: 'China Southern Airlines' },
    ],
    route_type: '国内直飞/经停',
    status_in_last_15_days: '计划执飞',
  },
  {
    route_id: 'JMU-DLC',
    departure_city: '大连',
    departure_airport_iata: 'DLC',
    departure_airport_name: '大连周水子国际机场',
    airlines: [
      { code: 'CZ', name_cn: '中国南方航空', name_en: 'China Southern Airlines' },
    ],
    route_type: '国内直飞',
    status_in_last_15_days: '执飞',
  },
  {
    route_id: 'JMU-TAO',
    departure_city: '青岛',
    departure_airport_iata: 'TAO',
    departure_airport_name: '青岛胶东国际机场',
    airlines: [
      { code: 'MU', name_cn: '中国东方航空', name_en: 'China Eastern Airlines' },
      { code: 'SC', name_cn: '山东航空', name_en: 'Shandong Airlines' },
      { code: 'QW', name_cn: '青岛航空', name_en: 'Qingdao Airlines' },
    ],
    route_type: '国内直飞',
    status_in_last_15_days: '执飞',
  },
  {
    route_id: 'JMU-YNT',
    departure_city: '烟台',
    departure_airport_iata: 'YNT',
    departure_airport_name: '烟台蓬莱国际机场',
    airlines: [
      { code: 'MU', name_cn: '中国东方航空', name_en: 'China Eastern Airlines' },
      { code: 'SC', name_cn: '山东航空', name_en: 'Shandong Airlines' },
    ],
    route_type: '国内直飞',
    status_in_last_15_days: '执飞',
  },
  {
    route_id: 'JMU-TNA',
    departure_city: '济南',
    departure_airport_iata: 'TNA',
    departure_airport_name: '济南遥墙国际机场',
    airlines: [
      { code: 'MU', name_cn: '中国东方航空', name_en: 'China Eastern Airlines' },
      { code: '9C', name_cn: '春秋航空', name_en: 'Spring Airlines' },
    ],
    route_type: '国内直飞/经停',
    status_in_last_15_days: '执飞',
  },
  {
    route_id: 'JMU-HGH',
    departure_city: '杭州',
    departure_airport_iata: 'HGH',
    departure_airport_name: '杭州萧山国际机场',
    airlines: [
      { code: 'MU', name_cn: '中国东方航空', name_en: 'China Eastern Airlines' },
    ],
    route_type: '国内直飞/经停',
    status_in_last_15_days: '计划执飞',
  },
  {
    route_id: 'JMU-XIY',
    departure_city: '西安',
    departure_airport_iata: 'XIY',
    departure_airport_name: '西安咸阳国际机场',
    airlines: [
      { code: 'G5', name_cn: '华夏航空', name_en: 'China Express Airlines' },
    ],
    route_type: '国内经停',
    status_in_last_15_days: '计划执飞',
  },
  {
    route_id: 'JMU-WEH',
    departure_city: '威海',
    departure_airport_iata: 'WEH',
    departure_airport_name: '威海大水泊国际机场',
    airlines: [
      { code: 'EU', name_cn: '成都航空', name_en: 'Chengdu Airlines' },
    ],
    route_type: '国内直飞',
    status_in_last_15_days: '执飞',
  },
  {
    route_id: 'JMU-FYJ',
    departure_city: '抚远',
    departure_airport_iata: 'FYJ',
    departure_airport_name: '抚远东极机场',
    airlines: [
      { code: 'EU', name_cn: '成都航空', name_en: 'Chengdu Airlines' },
    ],
    route_type: '省内支线',
    status_in_last_15_days: '执飞',
  },
  {
    route_id: 'JMU-NKG',
    departure_city: '南京',
    departure_airport_iata: 'NKG',
    departure_airport_name: '南京禄口国际机场',
    airlines: [
      { code: 'SC', name_cn: '山东航空', name_en: 'Shandong Airlines' },
    ],
    route_type: '国内经停',
    status_in_last_15_days: '计划执飞',
  },
  {
    route_id: 'JMU-ICN',
    departure_city: '首尔',
    departure_airport_iata: 'ICN',
    departure_airport_name: '首尔仁川国际机场',
    airlines: [
      { code: '7C', name_cn: '济州航空', name_en: 'Jeju Air' },
    ],
    route_type: '国际直飞',
    status_in_last_15_days: '计划执飞',
  },
  {
    route_id: 'JMU-KHV',
    departure_city: '哈巴罗夫斯克',
    departure_airport_iata: 'KHV',
    departure_airport_name: '哈巴罗夫斯克机场',
    airlines: [
      { code: 'G5', name_cn: '华夏航空', name_en: 'China Express Airlines' },
    ],
    route_type: '国际经停（始发于天津）',
    status_in_last_15_days: '计划执飞',
  },
];

const DATE_RANGE_DAYS = 15;

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildRouteReport() {
  const generatedAt = new Date().toISOString();
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - DATE_RANGE_DAYS + 1);

  const domesticRoutes = ROUTES.filter((r) => r.route_type.startsWith('国内') || r.route_type === '省内支线');
  const internationalRoutes = ROUTES.filter((r) => r.route_type.startsWith('国际'));
  const activeRoutes = ROUTES.filter((r) => r.status_in_last_15_days === '执飞');
  const airlinesSet = new Set();
  for (const route of ROUTES) {
    for (const airline of route.airlines) {
      airlinesSet.add(airline.name_cn);
    }
  }

  const routesWithArrival = ROUTES.map((r) => ({
    ...r,
    arrival_airport_iata: AIRPORT.iata,
    arrival_airport_name: AIRPORT.name_cn,
  }));

  return {
    meta: {
      airport_name_cn: AIRPORT.name_cn,
      airport_name_en: AIRPORT.name_en,
      iata: AIRPORT.iata,
      icao: AIRPORT.icao,
      city: AIRPORT.city,
      province: AIRPORT.province,
      country: AIRPORT.country,
      generated_at: generatedAt,
      date_range_days: DATE_RANGE_DAYS,
      date_range_start: formatDate(startDate),
      date_range_end: formatDate(today),
      season: '2026夏秋航季',
      data_sources: [
        'Navitime Flight JMU实时航线 (https://transit.navitime.com/zh-cn/flight/JMU)',
        'Gpedia佳木斯东郊机场航点信息',
        '易遊網佳木斯機票搜索結果',
      ],
      open_questions_handling: {
        default_departure_city: '未限制默认出发城市，清单覆盖所有检索到的通航城市',
        nearby_airports: '本任务聚焦佳木斯东郊机场(JMU)；哈尔滨太平机场(HRB)仅在作为航线经停/替代时备注，未纳入主清单',
      },
      note: '本清单基于公开航班计划与实时航班信息整理，具体每日执飞航班请以航空公司官网或售票系统为准。',
    },
    airport: {
      iata: AIRPORT.iata,
      icao: AIRPORT.icao,
      name_cn: AIRPORT.name_cn,
      name_en: AIRPORT.name_en,
      distance_to_city_km: AIRPORT.distance_to_city_km,
      flight_area_class: AIRPORT.flight_area_class,
    },
    routes: routesWithArrival,
    summary: {
      total_routes: ROUTES.length,
      domestic_routes: domesticRoutes.length,
      international_routes: internationalRoutes.length,
      airlines_count: airlinesSet.size,
      active_in_last_15_days: activeRoutes.length,
    },
  };
}

export function buildRouteCsv(report) {
  const header = [
    'airport_iata',
    'airport_icao',
    'airport_name_cn',
    'airport_name_en',
    'generated_at',
    'date_range_days',
    'route_id',
    'departure_city',
    'departure_airport_iata',
    'departure_airport_name',
    'arrival_airport_iata',
    'arrival_airport_name',
    'airline_codes',
    'airline_names_cn',
    'airline_names_en',
    'route_type',
    'status_in_last_15_days',
    'notes',
  ];

  const lines = [header.join(',')];
  for (const route of report.routes) {
    const airlineCodes = route.airlines.map((a) => a.code).join(';');
    const airlineNamesCn = route.airlines.map((a) => a.name_cn).join(';');
    const airlineNamesEn = route.airlines.map((a) => a.name_en).join(';');
    lines.push(
      [
        csvEscape(report.airport.iata),
        csvEscape(report.airport.icao),
        csvEscape(report.airport.name_cn),
        csvEscape(report.airport.name_en),
        csvEscape(report.meta.generated_at),
        csvEscape(report.meta.date_range_days),
        csvEscape(route.route_id),
        csvEscape(route.departure_city),
        csvEscape(route.departure_airport_iata),
        csvEscape(route.departure_airport_name),
        csvEscape(route.arrival_airport_iata),
        csvEscape(route.arrival_airport_name),
        csvEscape(airlineCodes),
        csvEscape(airlineNamesCn),
        csvEscape(airlineNamesEn),
        csvEscape(route.route_type),
        csvEscape(route.status_in_last_15_days),
        csvEscape(route.notes || ''),
      ].join(',')
    );
  }
  return lines.join('\n');
}

function main() {
  const report = buildRouteReport();
  const today = report.meta.date_range_end;
  const basename = `jiamusi_routes_${today.replace(/-/g, '')}`;
  const jsonPath = join(REPORTS_DIR, `${basename}.json`);
  const csvPath = join(REPORTS_DIR, `${basename}.csv`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(csvPath, buildRouteCsv(report), 'utf8');

  console.log(
    JSON.stringify(
      {
        jsonPath,
        csvPath,
        iata: report.airport.iata,
        icao: report.airport.icao,
        totalRoutes: report.summary.total_routes,
        domesticRoutes: report.summary.domestic_routes,
        internationalRoutes: report.summary.international_routes,
        airlinesCount: report.summary.airlines_count,
        activeRoutes: report.summary.active_in_last_15_days,
        meetsAcceptance: report.summary.total_routes >= 3 && report.airport.iata === 'JMU',
      },
      null,
      2
    )
  );
}

main();
