import { DateTime } from 'luxon';
import { expect, it } from 'vitest';
import { center, date, input, order } from '../test-fixtures.js';
import {
  calculateEndDateWithShifts,
  intervalsOverlap,
  type IInterval,
} from '../utils/date-utils.js';
import { validateInput } from './constraint-checker.js';
import { assertAcyclic, buildDependencyGraph } from './dependency-graph.js';
import { placeOrders } from './placement.js';
import type { IReflowInput } from './types.js';

// Deliberately simple reference: sort all ready orders and linearly scan every reservation.
// It shares calendar arithmetic, but none of the heap, busy-run merging, or search shortcuts.
function reference(input: IReflowInput, urgency: Map<string, number>): Map<string, IInterval> {
  const lookup = validateInput(input);
  const placed = new Map<string, IInterval>();
  const reservations = input.workOrders
    .filter((w) => w.data.isMaintenance)
    .map((w) => {
      const span = lookup.originalIntervals.get(w.docId)!;
      placed.set(w.docId, span);
      return { center: w.data.workCenterId, span };
    });
  const processed = new Set<string>();
  const remaining = [...input.workOrders];
  const effective = (w: IReflowInput['workOrders'][number]) =>
    w.data.dependsOnWorkOrderIds.length
      ? Math.max(...w.data.dependsOnWorkOrderIds.map((id) => +placed.get(id)!.end))
      : +lookup.originalIntervals.get(w.docId)!.start;
  while (remaining.length) {
    const ready = remaining.filter((w) =>
      w.data.dependsOnWorkOrderIds.every((id) => processed.has(id)),
    );
    ready.sort((a, b) => {
      const aDue = urgency.get(a.docId) ?? Infinity,
        bDue = urgency.get(b.docId) ?? Infinity;
      return (
        (aDue < bDue ? -1 : aDue > bDue ? 1 : 0) ||
        effective(a) - effective(b) ||
        +lookup.originalIntervals.get(a.docId)!.start -
          +lookup.originalIntervals.get(b.docId)!.start ||
        (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0)
      );
    });
    const selected = ready[0];
    if (!selected) throw new Error('Reference encountered a cycle');
    if (!selected.data.isMaintenance) {
      let earliest = effective(selected);
      let accepted = false;
      const limit = reservations.length;
      for (let attempt = 0; attempt <= limit; attempt++) {
        const span = calculateEndDateWithShifts(
          DateTime.fromMillis(earliest, { zone: 'utc' }),
          selected.data.durationMinutes,
          lookup.byId.get(selected.data.workCenterId)!.data.shifts,
          lookup.maintenanceIntervals.get(selected.data.workCenterId)!,
          lookup.originalIntervals.get(selected.docId)!.start.plus({ days: 365 }),
          selected.data.setupTimeMinutes,
        );
        const conflicts = reservations
          .filter(
            (r) =>
              r.center === selected.data.workCenterId &&
              span.segments.some((segment) => intervalsOverlap(segment, r.span)),
          )
          .sort((a, b) => +a.span.start - +b.span.start);
        if (!conflicts.length) {
          placed.set(selected.docId, span);
          for (const segment of span.segments)
            reservations.push({ center: selected.data.workCenterId, span: segment });
          accepted = true;
          break;
        }
        earliest = +conflicts[0].span.end;
      }
      if (!accepted) throw new Error('Reference failed to advance');
    }
    processed.add(selected.docId);
    remaining.splice(remaining.indexOf(selected), 1);
  }
  return placed;
}

it.each(Array.from({ length: 30 }, (_, i) => i + 1))(
  'matches reference placement for heterogeneous DAG seed %i',
  (seed) => {
    let state = seed;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const centers = [
      center('day'),
      center('night', {
        shifts: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startHour: 20,
          endHour: 6,
        })),
        maintenanceWindows: [
          { startDate: '2026-11-02T23:00:00Z', endDate: '2026-11-03T01:00:00Z' },
        ],
      }),
    ];
    const orders = Array.from({ length: 20 }, (_, i) => {
      const start = Date.parse(date('08:00')) + Math.floor(random() * 2 * 86_400_000);
      return order(`job-${String(i).padStart(2, '0')}`, {
        workCenterId: random() < 0.5 ? 'day' : 'night',
        durationMinutes: 1 + Math.floor(random() * 150),
        setupTimeMinutes: Math.floor(random() * 20),
        startDate: new Date(start).toISOString(),
        endDate: new Date(start + 3_600_000).toISOString(),
        dependsOnWorkOrderIds: Array.from({ length: i }, (_, j) => j)
          .filter(() => random() < 0.1)
          .map((j) => `job-${String(j).padStart(2, '0')}`),
      });
    });
    orders.push(
      order('fixed-day', {
        isMaintenance: true,
        durationMinutes: 45,
        workCenterId: 'day',
        startDate: date('10:30'),
        endDate: date('11:15'),
      }),
    );
    orders.push(
      order('fixed-night', {
        isMaintenance: true,
        durationMinutes: 30,
        workCenterId: 'night',
        startDate: '2026-11-03T20:30:00Z',
        endDate: '2026-11-03T21:00:00Z',
      }),
    );
    const data = input(orders, centers),
      before = structuredClone(data);
    const lookup = validateInput(data),
      graph = buildDependencyGraph(data.workOrders);
    assertAcyclic(graph);
    for (const urgency of [
      new Map<string, number>(),
      new Map([['job-03', Date.parse(date('12:00'))]]),
    ]) {
      const optimized = placeOrders(data, lookup, graph, 365, urgency).placedIntervals;
      const expected = reference(data, urgency);
      for (const [id, span] of optimized)
        expect([+span.start, +span.end]).toEqual([
          +expected.get(id)!.start,
          +expected.get(id)!.end,
        ]);
    }
    expect(data).toEqual(before);
  },
);
