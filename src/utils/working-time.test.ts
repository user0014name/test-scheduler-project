import { expect, it } from 'vitest';
import { calculateEndDateWithShifts, parseUtc, toIso } from './date-utils.js';
const at = (s: string) => parseUtc(s, 'test');
const shifts = [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startHour: 8, endHour: 17 }));
const window = (start: string, end: string) => ({ start: at(start), end: at(end) });

it.each([
  ['2026-11-02T08:00:00Z', 480, '2026-11-02T08:00:00Z', '2026-11-02T16:00:00Z'],
  ['2026-11-02T16:00:00Z', 120, '2026-11-02T16:00:00Z', '2026-11-03T09:00:00Z'],
  ['2026-11-06T15:00:00Z', 300, '2026-11-06T15:00:00Z', '2026-11-09T11:00:00Z'],
  ['2026-11-07T10:00:00Z', 60, '2026-11-09T08:00:00Z', '2026-11-09T09:00:00Z'],
])('consumes working minutes from %s', (requested, duration, start, end) => {
  const result = calculateEndDateWithShifts(at(requested), duration, shifts, []);
  expect(toIso(result.start)).toBe(start);
  expect(toIso(result.end)).toBe(end);
});
it('records the exact overnight pause', () => {
  const result = calculateEndDateWithShifts(at('2026-11-02T16:00:00Z'), 120, shifts, []);
  expect(result.pauses.map((p) => [p.kind, toIso(p.from), toIso(p.to)])).toEqual([
    ['shift', '2026-11-02T17:00:00Z', '2026-11-03T08:00:00Z'],
  ]);
});
it.each([
  ['10:00', 180, '10:00', '14:00', 1],
  ['11:30', 60, '12:00', '13:00', 1],
  ['10:00', 60, '10:00', '11:00', 0],
  ['12:00', 60, '12:00', '13:00', 0],
])('uses half-open maintenance boundaries at %s', (requested, duration, start, end, pauses) => {
  const date = (time: string) => `2026-11-02T${time}:00Z`;
  const result = calculateEndDateWithShifts(at(date(requested)), duration, shifts, [
    window(date('11:00'), date('12:00')),
  ]);
  expect(toIso(result.start)).toBe(date(start));
  expect(toIso(result.end)).toBe(date(end));
  expect(result.pauses).toHaveLength(pauses);
});
it('supports split shifts and endHour 24', () => {
  const result = calculateEndDateWithShifts(
    at('2026-11-02T11:00:00Z'),
    120,
    [
      { dayOfWeek: 1, startHour: 8, endHour: 12 },
      { dayOfWeek: 1, startHour: 13, endHour: 17 },
    ],
    [],
  );
  expect(toIso(result.end)).toBe('2026-11-02T14:00:00Z');
  expect(
    toIso(
      calculateEndDateWithShifts(
        at('2026-11-02T23:00:00Z'),
        90,
        [{ dayOfWeek: 1, startHour: 20, endHour: 24 }],
        [],
      ).end,
    ),
  ).toBe('2026-11-09T20:30:00Z');
});
it('rejects no shifts and invalid working durations', () => {
  expect(() => calculateEndDateWithShifts(at('2026-11-02T08:00:00Z'), 60, [], [])).toThrowError(
    expect.objectContaining({ code: 'NO_SHIFTS' }),
  );
  for (const duration of [0, -1, NaN, Infinity]) {
    expect(() =>
      calculateEndDateWithShifts(at('2026-11-02T08:00:00Z'), duration, shifts, []),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  }
});
it('bounds blocked-time jumps and succeeds with a larger deadline', () => {
  const start = at('2026-11-02T08:00:00Z');
  const windows = [window('2026-11-02T00:00:00Z', '2028-11-02T00:00:00Z')];
  expect(() => calculateEndDateWithShifts(start, 60, shifts, windows)).toThrowError(
    expect.objectContaining({ code: 'HORIZON_EXCEEDED' }),
  );
  expect(
    toIso(calculateEndDateWithShifts(start, 60, shifts, windows, start.plus({ days: 800 })).end),
  ).toBe('2028-11-02T09:00:00Z');
});
it('allows exact deadline completion but rejects completion beyond it', () => {
  const start = at('2026-11-02T08:00:00Z');
  const end = start.plus({ minutes: 60 });
  expect(toIso(calculateEndDateWithShifts(start, 60, shifts, [], end).end)).toBe(toIso(end));
  expect(() => calculateEndDateWithShifts(start, 61, shifts, [], end)).toThrowError(
    expect.objectContaining({ code: 'HORIZON_EXCEEDED' }),
  );
});
it('handles overlapping windows without double counting capacity', () => {
  const r = calculateEndDateWithShifts(at('2026-11-02T10:00:00Z'), 120, shifts, [
    window('2026-11-02T11:00:00Z', '2026-11-02T13:00:00Z'),
    window('2026-11-02T12:00:00Z', '2026-11-02T14:00:00Z'),
  ]);
  expect(toIso(r.end)).toBe('2026-11-02T15:00:00Z');
});
