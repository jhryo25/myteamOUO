import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCanJmuCombos, buildComboReport, buildComboCsv } from '../tools/build-can-jmu-route-combos.mjs';

function makeLeg(overrides = {}) {
  return {
    flightNo: 'JD9999',
    dtime: '2026-06-21 08:00:00',
    atime: '2026-06-21 12:00:00',
    duration: 240,
    airline: { code: 'JD', name: 'Test Air' },
    dport: { code: 'CAN', fullName: '白云国际机场', cityName: '广州', terminal: 'T2' },
    aport: { code: 'JMU', fullName: '东郊国际机场', cityName: '佳木斯', terminal: '' },
    ...overrides,
  };
}

function makeRawWithFlights(flightsPerKey) {
  const raw = {};
  for (const [key, flights] of Object.entries(flightsPerKey)) {
    raw[key] = {
      sourceUrl: `https://m.ctrip.com/html5/flight/CAN-JMU-day-${key.split('_')[1]}.html`,
      listData: { flights },
    };
  }
  return { raw };
}

test('extractCanJmuCombos returns direct option for single-leg CAN→JMU flight', () => {
  const priceRaw = makeRawWithFlights({
    'CAN_2026-06-21': [
      {
        flightItem: {
          flights: [makeLeg({ flightNo: 'CZ6123' })],
          duration: 240,
        },
      },
    ],
  });
  const combos = extractCanJmuCombos(priceRaw);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].segment_type, '直飞');
  assert.equal(combos[0].segments[0].flight_no, 'CZ6123');
  assert.equal(combos[0].destination_airport_iata, 'JMU');
});

test('extractCanJmuCombos returns one-stop option for two-leg CAN→hub→JMU flight', () => {
  const priceRaw = makeRawWithFlights({
    'CAN_2026-06-22': [
      {
        flightItem: {
          flights: [
            makeLeg({
              flightNo: 'JD5922',
              dport: { code: 'CAN', fullName: '白云国际机场', cityName: '广州', terminal: 'T3' },
              aport: { code: 'PKX', fullName: '大兴国际机场', cityName: '北京', terminal: '' },
              duration: 180,
            }),
            makeLeg({
              flightNo: 'KN5597',
              dport: { code: 'PKX', fullName: '大兴国际机场', cityName: '北京', terminal: '' },
              aport: { code: 'JMU', fullName: '东郊国际机场', cityName: '佳木斯', terminal: '' },
              duration: 140,
            }),
          ],
          duration: 1300,
        },
      },
    ],
  });
  const combos = extractCanJmuCombos(priceRaw);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].segment_type, '一次中转');
  assert.equal(combos[0].transfer_airport_iata, 'PKX');
  assert.equal(combos[0].segments.length, 2);
  assert.equal(combos[0].segments[1].arr_airport_iata, 'JMU');
});

test('extractCanJmuCombos deduplicates identical flight combos on the same date', () => {
  const flight = {
    flightItem: {
      flights: [makeLeg({ flightNo: 'CZ6123' })],
      duration: 240,
    },
  };
  const priceRaw = makeRawWithFlights({
    'CAN_2026-06-23': [flight, flight],
  });
  const combos = extractCanJmuCombos(priceRaw);
  assert.equal(combos.length, 1);
});

test('extractCanJmuCombos ignores options not ending at JMU', () => {
  const priceRaw = makeRawWithFlights({
    'CAN_2026-06-24': [
      {
        flightItem: {
          flights: [makeLeg({ aport: { code: 'PKX', fullName: '大兴国际机场', cityName: '北京', terminal: '' } })],
          duration: 180,
        },
      },
    ],
  });
  const combos = extractCanJmuCombos(priceRaw);
  assert.equal(combos.length, 0);
});

test('buildComboReport summary matches combo data', () => {
  const priceRaw = makeRawWithFlights({
    'CAN_2026-06-25': [
      { flightItem: { flights: [makeLeg()], duration: 240 } },
      {
        flightItem: {
          flights: [
            makeLeg({
              flightNo: 'JD1',
              aport: { code: 'PKX', fullName: '大兴国际机场', cityName: '北京', terminal: '' },
            }),
            makeLeg({
              flightNo: 'KN1',
              dport: { code: 'PKX', fullName: '大兴国际机场', cityName: '北京', terminal: '' },
            }),
          ],
          duration: 1300,
        },
      },
    ],
  });
  const combos = extractCanJmuCombos(priceRaw);
  const report = buildComboReport(combos, '/tmp/test.json');
  assert.equal(report.meta.total_options, combos.length);
  assert.equal(report.meta.direct_options, 1);
  assert.equal(report.meta.transit_options, 1);
  assert.equal(report.meta.origin_code, 'CAN');
  assert.equal(report.meta.destination_code, 'JMU');
});

test('buildComboCsv produces header and one row per segment', () => {
  const priceRaw = makeRawWithFlights({
    'CAN_2026-06-26': [
      {
        flightItem: {
          flights: [
            makeLeg({
              flightNo: 'JD1',
              aport: { code: 'PKX', fullName: '大兴国际机场', cityName: '北京', terminal: '' },
            }),
            makeLeg({
              flightNo: 'KN1',
              dport: { code: 'PKX', fullName: '大兴国际机场', cityName: '北京', terminal: '' },
            }),
          ],
          duration: 1300,
        },
      },
    ],
  });
  const combos = extractCanJmuCombos(priceRaw);
  const report = buildComboReport(combos, '/tmp/test.json');
  const csv = buildComboCsv(report);
  const lines = csv.split('\n');
  assert.ok(lines[0].includes('option_id'));
  assert.ok(lines[0].includes('flight_no'));
  assert.ok(lines[0].includes('segment_type'));
  assert.equal(lines.length, combos.length * 2 + 1);
  assert.ok(lines[1].startsWith('CAN-JMU-'));
});
