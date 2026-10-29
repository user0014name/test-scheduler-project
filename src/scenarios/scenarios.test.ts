import { expect, it } from 'vitest';
import { ReflowService } from '../reflow/reflow.service.js';
import { findViolations, validateInput } from '../reflow/constraint-checker.js';
import { scenarios } from './index.js';
const svc = new ReflowService();
const scenario = (id: string) => scenarios.find((s) => s.id === id)!;
const run = (id: string) => svc.reflow(scenario(id).input);
const expected = (start: string, end: string, startDelta: number, endDelta: number) => ({
  newStartDate: start,
  newEndDate: end,
  startDeltaMinutes: startDelta,
  endDeltaMinutes: endDelta,
});
it('pins the delay cascade schedule and metrics', () => {
  const result = run('delay-cascade');
  expect(result.changes).toMatchObject([
    expected('2026-11-02T08:00:00Z', '2026-11-02T16:00:00Z', 0, 240),
    expected('2026-11-02T16:00:00Z', '2026-11-03T09:00:00Z', 240, 1140),
    expected('2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z', 1140, 1140),
  ]);
  expect(result.changes).toHaveLength(3);
  // A completes four hours later. B and C each complete nineteen elapsed hours later:
  // Monday 14:00 -> Tuesday 09:00, and Monday 15:00 -> Tuesday 10:00.
  expect(result.metrics).toEqual({
    totalDelayMinutes: 4 * 60 + 19 * 60 + 19 * 60,
    affectedWorkOrders: 3,
  });
  expect(result.updatedWorkOrders[3]).toEqual(scenario('delay-cascade').input.workOrders[3]);
});
it('pins overnight and weekend shift-boundary behavior', () => {
  const result = run('shift-boundary');
  expect(result.changes).toMatchObject([
    expected('2026-11-02T16:00:00Z', '2026-11-03T09:00:00Z', 0, 900),
    expected('2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z', 30, 30),
    expected('2026-11-06T15:00:00Z', '2026-11-09T11:00:00Z', 0, 3780),
  ]);
  // Monday 18:00 -> Tuesday 09:00 = 15 hours; the competing order moves 30 minutes.
  // Friday 20:00 -> Monday 11:00 = 63 hours, including the weekend.
  expect(result.metrics).toEqual({
    totalDelayMinutes: 15 * 60 + 30 + 63 * 60,
    affectedWorkOrders: 3,
  });
});
it('pins maintenance-window behavior and preserves reasons after conflicts', () => {
  const result = run('maintenance-window');
  expect(result.changes).toMatchObject([
    expected('2026-11-02T10:00:00Z', '2026-11-02T14:00:00Z', 0, 60),
    expected('2026-11-02T14:00:00Z', '2026-11-02T15:00:00Z', 150, 150),
    expected('2026-11-03T10:00:00Z', '2026-11-03T11:00:00Z', 120, 120),
  ]);
  expect(result.updatedWorkOrders[2]).toEqual(scenario('maintenance-window').input.workOrders[2]);
  expect(result.changes[1].reasons.map((r) => r.kind)).toEqual(
    expect.arrayContaining(['maintenanceWindow', 'workCenterConflict']),
  );
  // H ends at 14:00 rather than 13:00 (+60); I at 15:00 rather than 12:30 (+150);
  // J at 11:00 rather than 09:00 (+120). Fixed maintenance contributes no date change.
  expect(result.metrics).toEqual({
    totalDelayMinutes: 60 + 150 + 120,
    affectedWorkOrders: 3,
  });
});
it('reports the expected impossible cycle', () => {
  const data = scenario('circular-dependency');
  expect(data.expectedErrorCode).toBe('CIRCULAR_DEPENDENCY');
  expect(() => svc.reflow(data.input)).toThrowError(
    expect.objectContaining({ code: data.expectedErrorCode }),
  );
});
it('every successful scenario satisfies the post-check and leaves its input unchanged', () => {
  for (const data of scenarios.filter((s) => !s.expectedErrorCode)) {
    const snapshot = structuredClone(data.input);
    expect(
      findViolations(
        data.input,
        svc.reflow(data.input).updatedWorkOrders,
        validateInput(data.input),
      ),
    ).toEqual([]);
    expect(data.input).toEqual(snapshot);
  }
});
