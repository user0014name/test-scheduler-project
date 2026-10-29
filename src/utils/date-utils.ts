import { DateTime } from 'luxon';
import { ReflowError, type IShift } from '../reflow/types.js';

export interface IInterval {
  start: DateTime;
  end: DateTime;
}

export interface IPause {
  kind: 'shift' | 'maintenance';
  from: DateTime;
  to: DateTime;
}

export interface IWorkingSpan extends IInterval {
  pauses: IPause[];
  segments: IInterval[];
}

export const MAX_CALC_ITERATIONS = 10_000;
export const DEFAULT_MAX_HORIZON_DAYS = 365;

/** Round the combined productive duration up once to the clock's millisecond precision. */
export function workingMilliseconds(minutes: number, setupMinutes = 0): number {
  if (
    !Number.isFinite(minutes) ||
    minutes <= 0 ||
    !Number.isFinite(setupMinutes) ||
    setupMinutes < 0
  ) {
    throw new ReflowError(
      'INVALID_INPUT',
      'Working duration must be positive and setup nonnegative',
    );
  }
  // Treat the shortest decimal representation of each input as authoritative. Integer decimal
  // arithmetic avoids multiplication/addition noise without rounding away real sub-ms fractions.
  const parts = [minutes, setupMinutes].map((value) => {
    const [decimal, exponent = '0'] = value.toString().split('e');
    return {
      coefficient: BigInt(decimal.replace('.', '')),
      scale: (decimal.split('.')[1]?.length ?? 0) - Number(exponent),
    };
  });
  const scale = Math.max(0, ...parts.map((part) => part.scale));
  const denominator = 10n ** BigInt(scale);
  const numerator =
    parts.reduce((sum, part) => sum + part.coefficient * 10n ** BigInt(scale - part.scale), 0n) *
    60_000n;
  const milliseconds = Number((numerator + denominator - 1n) / denominator);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new ReflowError(
      'INVALID_INPUT',
      'Working duration must be positive and fit millisecond precision',
    );
  }
  return milliseconds;
}

/** Add order context at the boundary where calendar failures become scheduling failures. */
export function forWorkOrders<T>(ids: string[], action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof ReflowError && !error.workOrderIds.length) {
      throw new ReflowError(error.code, error.message, ids);
    }
    throw error;
  }
}

export function forWorkOrder<T>(id: string, action: () => T): T {
  return forWorkOrders([id], action);
}

export function assertWithinDeadline(value: DateTime, deadline: DateTime): void {
  if (value > deadline) {
    throw new ReflowError(
      'HORIZON_EXCEEDED',
      `No complete placement found by ${toIso(deadline)} under this scheduling policy; a schedule may exist beyond this limit or with another ordering.`,
    );
  }
}

/** Pauses work outside shifts and inside half-open maintenance windows. */
export function calculateEndDateWithShifts(
  requestedStart: DateTime,
  workingMinutes: number,
  shifts: IShift[],
  maintenanceWindows: IInterval[],
  deadline: DateTime = requestedStart.plus({ days: DEFAULT_MAX_HORIZON_DAYS }),
  setupMinutes = 0,
): IWorkingSpan {
  if (
    !requestedStart.isValid ||
    !deadline.isValid ||
    !Number.isFinite(workingMinutes) ||
    workingMinutes <= 0
  ) {
    throw new ReflowError(
      'INVALID_INPUT',
      'Working duration must be positive and dates must be valid',
    );
  }
  if (!shifts.length) {
    throw new ReflowError(
      'NO_SHIFTS',
      'Positive production requires at least one work-center shift',
    );
  }

  // Consume duration only inside working blocks; pauses advance the calendar cursor.
  let cursor = requestedStart;
  let remainingMilliseconds = workingMilliseconds(workingMinutes, setupMinutes);
  let actualStart: DateTime | undefined;
  const pauses: IPause[] = [];
  const segments: IInterval[] = [];
  // Sort a copy: calendar calculation must not reorder the caller's windows.
  const windows = [...maintenanceWindows].sort((a, b) => a.start.toMillis() - b.start.toMillis());

  let windowIndex = 0;
  for (let iteration = 0; iteration < MAX_CALC_ITERATIONS; iteration++) {
    assertWithinDeadline(cursor, deadline);
    const shift = nextShiftInterval(cursor, shifts);
    if (!shift) {
      throw new ReflowError('NO_SHIFTS', 'No usable work-center shifts');
    }
    if (shift.start > cursor) {
      pauses.push({ kind: 'shift', from: cursor, to: shift.start });
      cursor = shift.start;
      assertWithinDeadline(cursor, deadline);
    }

    // Recheck shifts after maintenance: its end may fall outside working hours.
    while (windowIndex < windows.length && windows[windowIndex].end <= cursor) windowIndex++;
    const window = windows[windowIndex];
    const activeMaintenance = window && window.start <= cursor ? window : undefined;
    if (activeMaintenance) {
      pauses.push({ kind: 'maintenance', from: cursor, to: activeMaintenance.end });
      cursor = activeMaintenance.end;
      assertWithinDeadline(cursor, deadline);
      continue;
    }

    // Leading pauses move the actual start; later pauses extend the elapsed reservation.
    actualStart ??= cursor;

    // Stop at whichever comes first: maintenance or shift end.
    const nextWindow =
      window && cursor < window.start && window.start < shift.end ? window : undefined;
    const blockEnd = nextWindow?.start ?? shift.end;
    const availableMilliseconds = blockEnd.toMillis() - cursor.toMillis();
    if (availableMilliseconds <= 0) {
      throw new ReflowError('SCHEDULE_INVALID', 'Working-time cursor failed to advance');
    }
    if (remainingMilliseconds <= availableMilliseconds) {
      const end = cursor.plus({ milliseconds: remainingMilliseconds });
      assertWithinDeadline(end, deadline);
      segments.push({ start: cursor, end });
      return { start: actualStart, end, pauses, segments };
    }

    segments.push({ start: cursor, end: blockEnd });
    remainingMilliseconds -= availableMilliseconds;
    cursor = blockEnd;
  }

  throw new ReflowError(
    'HORIZON_EXCEEDED',
    `Calendar search reached its ${MAX_CALC_ITERATIONS} iteration limit; this does not prove infeasibility`,
  );
}

/** Productive portions of a supplied half-open interval, independent of required duration. */
export function* workingIntervalsBetween(
  start: DateTime,
  end: DateTime,
  shifts: IShift[],
  maintenanceWindows: IInterval[],
): Generator<IInterval> {
  if (!start.isValid || !end.isValid)
    throw new ReflowError('INVALID_INPUT', 'Invalid calendar interval');
  const windows = [...maintenanceWindows].sort((a, b) => +a.start - +b.start);
  let cursor = start;
  let windowIndex = 0;
  for (let iteration = 0; iteration < MAX_CALC_ITERATIONS; iteration++) {
    if (cursor >= end) return;
    const shift = nextShiftInterval(cursor, shifts);
    if (!shift || shift.start >= end) return;
    cursor = shift.start;
    while (windowIndex < windows.length && windows[windowIndex].end <= cursor) windowIndex++;
    const window = windows[windowIndex];
    if (window && window.start <= cursor) {
      cursor = window.end;
      continue;
    }
    let blockEnd = shift.end < end ? shift.end : end;
    if (window && window.start < blockEnd) blockEnd = window.start;
    if (blockEnd <= cursor)
      throw new ReflowError('SCHEDULE_INVALID', 'Calendar cursor failed to advance');
    yield { start: cursor, end: blockEnd };
    cursor = blockEnd;
  }
  if (cursor < end)
    throw new ReflowError(
      'HORIZON_EXCEEDED',
      'Calendar interval search reached its iteration limit',
    );
}

export function parseUtc(value: string, field: string): DateTime {
  // Reject zone-less timestamps: silently assigning the host timezone is unsafe.
  if (
    typeof value !== 'string' ||
    !value.includes('T') ||
    !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ||
    /[.,]\d{3}\d*[1-9]\d*(?:Z|[+-])/.test(value)
  ) {
    throw new ReflowError(
      'INVALID_INPUT',
      `${field} must be an ISO timestamp with an explicit timezone and millisecond precision`,
    );
  }
  const result = DateTime.fromISO(value, { setZone: true }).toUTC();
  if (!result.isValid) {
    throw new ReflowError('INVALID_INPUT', `Invalid ${field}: ${value}`);
  }
  return result;
}

export function toIso(date: DateTime): string {
  return date.toUTC().toISO({ suppressMilliseconds: date.millisecond === 0 })!;
}

export function minutesBetween(start: DateTime, end: DateTime): number {
  return (end.toMillis() - start.toMillis()) / 60_000;
}

export function intervalsOverlap(a: IInterval, b: IInterval): boolean {
  // Half-open intervals allow an order to start exactly when another ends.
  return a.start < b.end && b.start < a.end;
}

export function nextShiftInterval(from: DateTime, shifts: IShift[]): IInterval | null {
  let next: IInterval | null = null;
  // Include the same weekday next week when today's shift has already ended.
  for (let offset = -1; offset <= 7; offset++) {
    const day = from.toUTC().startOf('day').plus({ days: offset });
    for (const shift of shifts) {
      // Luxon uses ISO weekdays (Sunday=7); the input convention is Sunday=0.
      if (day.weekday % 7 !== shift.dayOfWeek) {
        continue;
      }
      const start = day.plus({ hours: shift.startHour });
      const end = day.plus({ hours: shift.endHour + (shift.endHour <= shift.startHour ? 24 : 0) });
      if (end <= from) {
        continue;
      }
      // A shift already in progress is usable from the requested time onward.
      const usableStart = start < from ? from : start;
      if (!next || usableStart < next.start) {
        next = { start: usableStart, end };
      }
    }
    if (next) {
      return next;
    }
  }
  return null;
}
