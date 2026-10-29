import { expect, it } from 'vitest';
import { parseUtc, workingIntervalsBetween } from './date-utils.js';

const at = (value: string) => parseUtc(value, 'test');

it('clips occupied intervals at both supplied endpoints through overnight maintenance', () => {
  const start = at('2026-11-02T23:30:00Z'),
    end = at('2026-11-03T02:30:00Z');
  const segments = [
    ...workingIntervalsBetween(
      start,
      end,
      [{ dayOfWeek: 1, startHour: 20, endHour: 6 }],
      [
        { start: at('2026-11-03T00:00:00Z'), end: at('2026-11-03T01:00:00Z') },
        { start: at('2026-11-03T00:30:00Z'), end: at('2026-11-03T02:00:00Z') },
      ],
    ),
  ];
  expect(segments.map((s) => [s.start.toISO(), s.end.toISO()])).toEqual([
    ['2026-11-02T23:30:00.000Z', '2026-11-03T00:00:00.000Z'],
    ['2026-11-03T02:00:00.000Z', '2026-11-03T02:30:00.000Z'],
  ]);
});

it('finds no working capacity in an overnight break or a half-open empty interval', () => {
  const shifts = [
    { dayOfWeek: 1, startHour: 8, endHour: 17 },
    { dayOfWeek: 2, startHour: 8, endHour: 17 },
  ];
  expect([
    ...workingIntervalsBetween(at('2026-11-02T17:00:00Z'), at('2026-11-03T08:00:00Z'), shifts, []),
  ]).toEqual([]);
  expect([
    ...workingIntervalsBetween(at('2026-11-02T08:00:00Z'), at('2026-11-02T08:00:00Z'), shifts, []),
  ]).toEqual([]);
});

it.each(Array.from({ length: 20 }, (_, i) => i + 1))(
  'matches a minute oracle for occupied intervals, seed %i',
  (seed) => {
    let state = seed;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const night = random() < 0.5;
    const shifts = [0, 1, 2, 3, 4, 5, 6]
      .filter(() => random() < 0.75)
      .map((dayOfWeek) => ({ dayOfWeek, startHour: night ? 20 : 8, endHour: night ? 6 : 17 }));
    const base = Date.parse('2026-11-02T00:00:00Z');
    const start = base + Math.floor(random() * 1440) * 60_000,
      end = start + 3000 * 60_000;
    const windows = Array.from({ length: 4 }, () => {
      const from = base + Math.floor(random() * 4000) * 60_000;
      return {
        start: at(new Date(from).toISOString()),
        end: at(new Date(from + 120 * 60_000).toISOString()),
      };
    });
    const expected: number[] = [];
    for (let cursor = start; cursor < end; cursor += 60_000) {
      const date = new Date(cursor),
        day = date.getUTCDay(),
        hour = date.getUTCHours();
      const working = shifts.some((s) =>
        night
          ? (s.dayOfWeek === day && hour >= 20) || (s.dayOfWeek === (day + 6) % 7 && hour < 6)
          : s.dayOfWeek === day && hour >= 8 && hour < 17,
      );
      if (working && !windows.some((w) => +w.start <= cursor && cursor < +w.end))
        expected.push(cursor);
    }
    const actual: number[] = [];
    for (const segment of workingIntervalsBetween(
      at(new Date(start).toISOString()),
      at(new Date(end).toISOString()),
      shifts,
      windows,
    )) {
      for (let cursor = +segment.start; cursor < +segment.end; cursor += 60_000)
        actual.push(cursor);
    }
    expect(actual).toEqual(expected);
  },
);
