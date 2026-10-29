import { expect, it } from 'vitest';
import { parseUtc, workingIntervalsBetween } from '../utils/date-utils.js';
import { Reservations } from './reservations.js';

const at = (value: string) => parseUtc(`2026-11-${value}:00Z`, 'test');
const reservation = (id: string, start: string, end: string) => ({
  workOrderId: id,
  interval: { start: at(start), end: at(end) },
});

it('bridges an overnight break while retaining exact reservation lookup', () => {
  const shifts = [1, 2].map((dayOfWeek) => ({ dayOfWeek, startHour: 8, endHour: 17 }));
  const index = new Reservations(
    (end, start) =>
      end >= start || workingIntervalsBetween(end, start, shifts, []).next().done === true,
  );
  index.add(reservation('a', '02T16:00', '02T17:00'));
  index.add(reservation('b', '03T08:00', '03T09:00'));
  expect(index.blockingRun({ start: at('02T16:30'), end: at('02T16:45') })?.interval.end).toEqual(
    at('03T09:00'),
  );
  expect(index.firstConflict({ start: at('02T18:00'), end: at('02T19:00') })).toBeUndefined();
  expect(index.firstConflict({ start: at('02T16:30'), end: at('02T16:45') })?.workOrderId).toBe(
    'a',
  );
});

it('retains usable working gaps and merges them only after they are filled', () => {
  const shifts = [{ dayOfWeek: 1, startHour: 8, endHour: 17 }];
  const index = new Reservations(
    (end, start) =>
      end >= start || workingIntervalsBetween(end, start, shifts, []).next().done === true,
  );
  index.add(reservation('a', '02T08:00', '02T09:00'));
  index.add(reservation('b', '02T11:00', '02T12:00'));
  const gap = { start: at('02T09:00'), end: at('02T10:00') };
  expect(index.blockingRun(gap)).toBeUndefined();
  index.add({ workOrderId: 'c', interval: gap });
  expect(index.blockingRun({ start: at('02T08:30'), end: at('02T08:45') })?.interval.end).toEqual(
    at('02T10:00'),
  );
  index.add(reservation('d', '02T10:00', '02T11:00'));
  expect(index.blockingRun({ start: at('02T08:30'), end: at('02T08:45') })?.interval.end).toEqual(
    at('02T12:00'),
  );
  expect(index.firstConflict({ start: at('02T10:30'), end: at('02T10:45') })?.workOrderId).toBe(
    'd',
  );
});
