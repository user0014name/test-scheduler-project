import { expect, it } from 'vitest';
import { center, date, input, order } from '../test-fixtures.js';
import { reflow } from './reflow.service.js';

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// Property tests with reproducible seeds and an independent Date-based minute-grid oracle.
// This deliberately avoids the scheduler's Luxon helpers and final constraint checker.
it.each(Array.from({ length: 40 }, (_, i) => i + 1))(
  'preserves scheduling invariants for generated DAG seed %i',
  (seed) => {
    const next = random(seed);
    const centers = Array.from({ length: 3 }, (_, i) =>
      center(`wc-${i}`, {
        shifts: [1, 2, 3, 4, 5].flatMap((dayOfWeek) => [
          { dayOfWeek, startHour: 8, endHour: 12 },
          { dayOfWeek, startHour: 13, endHour: 17 },
        ]),
        maintenanceWindows: [{ startDate: date('10:00'), endDate: date('10:30') }],
      }),
    );
    const orders = Array.from({ length: 24 }, (_, i) =>
      order(`job-${i.toString().padStart(2, '0')}`, {
        workCenterId: `wc-${Math.floor(next() * centers.length)}`,
        durationMinutes: 1 + Math.floor(next() * 120),
        setupTimeMinutes: Math.floor(next() * 20),
        startDate: new Date(
          Date.parse(date('08:00')) + Math.floor(next() * 120) * 60_000,
        ).toISOString(),
        endDate: date('17:00'),
        dependsOnWorkOrderIds: Array.from({ length: i }, (_, j) => j)
          .filter(() => next() < 0.08)
          .map((j) => `job-${j.toString().padStart(2, '0')}`),
      }),
    );
    const fixed = centers.map((c) =>
      order(`fixed-${c.docId}`, {
        workCenterId: c.docId,
        isMaintenance: true,
        startDate: date('14:00'),
        endDate: date('14:30'),
        durationMinutes: 30,
      }),
    );
    const data = input([...orders, ...fixed], centers);
    const snapshot = structuredClone(data);
    const result = reflow(data);
    expect(data).toEqual(snapshot);
    expect(reflow(data)).toEqual(result);
    const reversed = reflow({ ...data, workOrders: [...data.workOrders].reverse() });
    expect(new Map(reversed.updatedWorkOrders.map((w) => [w.docId, w.data]))).toEqual(
      new Map(result.updatedWorkOrders.map((w) => [w.docId, w.data])),
    );
    const byId = new Map(result.updatedWorkOrders.map((w) => [w.docId, w]));
    for (const scheduled of result.updatedWorkOrders) {
      const original = data.workOrders.find((w) => w.docId === scheduled.docId)!;
      const start = Date.parse(scheduled.data.startDate),
        end = Date.parse(scheduled.data.endDate);
      for (const parent of scheduled.data.dependsOnWorkOrderIds)
        expect(start).toBeGreaterThanOrEqual(Date.parse(byId.get(parent)!.data.endDate));
      if (scheduled.data.isMaintenance) {
        expect(scheduled).toEqual(original);
        continue;
      }
      if (!original.data.dependsOnWorkOrderIds.length)
        expect(start).toBeGreaterThanOrEqual(Date.parse(original.data.startDate));
      const calendar = centers.find((c) => c.docId === scheduled.data.workCenterId)!;
      let workingMinutes = 0;
      for (let cursor = start; cursor < end; cursor += 60_000) {
        const at = new Date(cursor);
        const withinShift = calendar.data.shifts.some(
          (s) =>
            s.dayOfWeek === at.getUTCDay() &&
            s.startHour <= at.getUTCHours() &&
            at.getUTCHours() < s.endHour,
        );
        const blocked =
          calendar.data.maintenanceWindows.some(
            (w) => Date.parse(w.startDate) <= cursor && cursor < Date.parse(w.endDate),
          ) ||
          fixed.some(
            (w) =>
              w.data.workCenterId === scheduled.data.workCenterId &&
              Date.parse(w.data.startDate) <= cursor &&
              cursor < Date.parse(w.data.endDate),
          );
        if (withinShift && !blocked) workingMinutes++;
      }
      expect(workingMinutes).toBe(
        scheduled.data.durationMinutes + (scheduled.data.setupTimeMinutes ?? 0),
      );
    }
    // Independently record occupied minutes; elapsed-span overlaps during maintenance are allowed.
    const occupied = new Set<string>();
    for (const scheduled of result.updatedWorkOrders) {
      const calendar = centers.find((c) => c.docId === scheduled.data.workCenterId)!;
      for (
        let cursor = Date.parse(scheduled.data.startDate);
        cursor < Date.parse(scheduled.data.endDate);
        cursor += 60_000
      ) {
        const at = new Date(cursor);
        const productive =
          scheduled.data.isMaintenance ||
          (calendar.data.shifts.some(
            (s) =>
              s.dayOfWeek === at.getUTCDay() &&
              s.startHour <= at.getUTCHours() &&
              at.getUTCHours() < s.endHour,
          ) &&
            !calendar.data.maintenanceWindows.some(
              (w) => Date.parse(w.startDate) <= cursor && cursor < Date.parse(w.endDate),
            ) &&
            !fixed.some(
              (w) =>
                w.data.workCenterId === scheduled.data.workCenterId &&
                Date.parse(w.data.startDate) <= cursor &&
                cursor < Date.parse(w.data.endDate),
            ));
        if (productive) {
          const key = scheduled.data.workCenterId + ':' + cursor;
          expect(occupied.has(key)).toBe(false);
          occupied.add(key);
        }
      }
    }
  },
);
