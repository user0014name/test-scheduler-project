import { describe, expect, it } from 'vitest';
import {
  intervalsOverlap,
  minutesBetween,
  nextShiftInterval,
  parseUtc,
  toIso,
} from './date-utils.js';

const at = (value: string) => parseUtc(value, 'test');
const shifts = [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startHour: 8, endHour: 17 }));
describe('UTC primitives', () => {
  it('normalizes offsets and preserves fractional seconds', () => {
    expect(toIso(at('2026-11-02T16:00:00+02:00'))).toBe('2026-11-02T14:00:00Z');
    expect(toIso(at('2026-11-02T16:00:00.123Z'))).toBe('2026-11-02T16:00:00.123Z');
    expect(toIso(at('2026-11-02T16:00:00+0200'))).toBe('2026-11-02T14:00:00Z');
    expect(toIso(at('2026-11-02T16:00:00,123000Z'))).toBe('2026-11-02T16:00:00.123Z');
    expect(toIso(at('2026-11-02T16:00:00.123000Z'))).toBe('2026-11-02T16:00:00.123Z');
  });
  it.each(['.1234', ',1234', ',0001'])(
    'rejects timestamp precision %s that would be silently lost',
    (fraction) => {
      expect(() => at('2026-11-02T16:00:00' + fraction + 'Z')).toThrowError(
        expect.objectContaining({ code: 'INVALID_INPUT' }),
      );
    },
  );
  it.each(['bad', '2026-02-30T08:00:00Z', '2026-11-02', '2026-11-02T08:00:00'])(
    'rejects invalid or unzoned timestamp %s',
    (value) => {
      expect(() => at(value)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    },
  );
  it('measures signed minutes and half-open intersections', () => {
    const a = { start: at('2026-11-02T10:00:00Z'), end: at('2026-11-02T11:00:00Z') };
    expect(minutesBetween(a.end, a.start)).toBe(-60);
    expect(intervalsOverlap(a, { start: a.end, end: a.end.plus({ hours: 1 }) })).toBe(false);
    expect(intervalsOverlap(a, { start: a.start.plus({ minutes: 30 }), end: a.end })).toBe(true);
  });
  it.each([
    ['2026-11-02T16:00:00Z', '2026-11-02T16:00:00Z', '2026-11-02T17:00:00Z'],
    ['2026-11-02T17:00:00Z', '2026-11-03T08:00:00Z', '2026-11-03T17:00:00Z'],
    ['2026-11-07T10:00:00Z', '2026-11-09T08:00:00Z', '2026-11-09T17:00:00Z'],
  ])('finds the next shift from %s', (from, start, end) => {
    const result = nextShiftInterval(at(from), shifts)!;
    expect(toIso(result.start)).toBe(start);
    expect(toIso(result.end)).toBe(end);
  });
  it('maps Sunday to zero and handles split shifts and midnight', () => {
    expect(
      toIso(
        nextShiftInterval(at('2026-11-08T07:00:00Z'), [
          { dayOfWeek: 0, startHour: 8, endHour: 24 },
        ])!.end,
      ),
    ).toBe('2026-11-09T00:00:00Z');
    expect(
      toIso(
        nextShiftInterval(at('2026-11-02T12:30:00Z'), [
          { dayOfWeek: 1, startHour: 8, endHour: 12 },
          { dayOfWeek: 1, startHour: 13, endHour: 17 },
        ])!.start,
      ),
    ).toBe('2026-11-02T13:00:00Z');
    expect(nextShiftInterval(at('2026-11-02T08:00:00Z'), [])).toBeNull();
  });
});
