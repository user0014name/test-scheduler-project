import { describe, expect, it } from 'vitest';
import { center, date, input, order } from '../test-fixtures.js';
import { findViolations, validateInput } from './constraint-checker.js';
import { ReflowService } from './reflow.service.js';
const svc = new ReflowService();
const code = (value: string) => expect.objectContaining({ code: value });
const scheduled = (orders: ReturnType<typeof order>[]) => svc.reflow(input(orders));

describe('reflow', () => {
  it('backtracks when both greedy policies miss feasible fixed maintenance dependencies', () => {
    const data = input(
      [
        order('a-short'),
        order('b-long', { durationMinutes: 180 }),
        order('urgent', { startDate: date('11:00'), endDate: date('12:00') }),
        order('m', {
          isMaintenance: true,
          startDate: date('13:00'),
          endDate: date('14:00'),
          dependsOnWorkOrderIds: ['a-short', 'b-long', 'urgent'],
        }),
        order('urgent-maintenance', {
          workCenterId: 'wc-2',
          isMaintenance: true,
          startDate: date('12:00'),
          endDate: date('13:00'),
          dependsOnWorkOrderIds: ['urgent'],
        }),
      ],
      [center(), center('wc-2')],
    );
    const snapshot = structuredClone(data);
    const result = svc.reflow(data);
    expect(result.updatedWorkOrders.map((w) => [w.data.startDate, w.data.endDate])).toEqual([
      [date('12:00'), date('13:00')],
      [date('08:00'), date('11:00')],
      [date('11:00'), date('12:00')],
      [date('13:00'), date('14:00')],
      [date('12:00'), date('13:00')],
    ]);
    expect(findViolations(data, result.updatedWorkOrders, validateInput(data))).toEqual([]);
    expect(data).toEqual(snapshot);
    expect(
      svc.reflow({ ...data, workOrders: [...data.workOrders].reverse() }).updatedWorkOrders,
    ).toEqual([...result.updatedWorkOrders].reverse());
    expect(svc.reflow({ ...data, workOrders: result.updatedWorkOrders }).changes).toEqual([]);
  });
  it('keeps a valid schedule unchanged and returns independent objects', () => {
    const data = input();
    const result = svc.reflow(data);
    expect(result.changes).toEqual([]);
    expect(result.explanation).toBe('Schedule already valid: no changes.');
    expect(result.updatedWorkOrders).toEqual(data.workOrders);
    expect(result.updatedWorkOrders[0]).not.toBe(data.workOrders[0]);
  });
  it('handles empty input', () => {
    expect(svc.reflow(input([])).metrics.affectedWorkOrders).toBe(0);
  });
  it('recomputes an overrun and explains a duration-only change', () => {
    const result = scheduled([order('a', { endDate: date('12:00'), durationMinutes: 480 })]);
    expect(result.changes[0]).toMatchObject({
      startDeltaMinutes: 0,
      endDeltaMinutes: 240,
      newEndDate: date('16:00'),
    });
    expect(result.changes[0]).toMatchObject({
      workOrderId: 'a',
      originalEndDate: date('12:00'),
      newEndDate: date('16:00'),
      reasons: [],
    });
  });
  it('reports signed negative end deltas', () => {
    expect(scheduled([order('a', { endDate: date('12:00') })]).metrics.totalDelayMinutes).toBe(
      -180,
    );
  });
  it('waits for every parent on multiple centers', () => {
    const data = input(
      [
        order('p1'),
        order('p2', { workCenterId: 'wc-2', durationMinutes: 180 }),
        order('child', { workCenterId: 'wc-3', dependsOnWorkOrderIds: ['p1', 'p2'] }),
      ],
      [center(), center('wc-2'), center('wc-3')],
    );
    const result = svc.reflow(data);
    expect(result.updatedWorkOrders[2].data.startDate).toBe(date('11:00'));
    expect(result.changes.find((c) => c.workOrderId === 'child')!.reasons).toContainEqual(
      expect.objectContaining({ kind: 'dependency', relatedId: 'p2' }),
    );
  });
  it('uses docId tie breaks independent of input order', () => {
    const result = scheduled([order('b'), order('a')]);
    expect(result.updatedWorkOrders[0].data.startDate).toBe(date('09:00'));
    expect(result.updatedWorkOrders[1].data.startDate).toBe(date('08:00'));
    expect(result.changes[0].reasons).toContainEqual(
      expect.objectContaining({ kind: 'workCenterConflict', relatedId: 'a' }),
    );
  });
  it('uses the documented ID priority even when a shorter job could finish first', () => {
    const result = scheduled([order('b-short'), order('a-long', { durationMinutes: 480 })]);
    expect(
      result.updatedWorkOrders.map((w) => [w.docId, w.data.startDate, w.data.endDate]),
    ).toEqual([
      ['b-short', date('16:00'), date('17:00')],
      ['a-long', date('08:00'), date('16:00')],
    ]);
    // Both release at 08:00: shortest-job-first could finish the short job at 09:00.
    // This test records the heuristic's limitation, without claiming optimal delay.
    expect(result.changes.find((c) => c.workOrderId === 'b-short')!.startDeltaMinutes).toBe(480);
  });
  it('places every short job in a finite ready backlog behind a long job', () => {
    const shortCount = 64;
    const orders = [
      order('a-long', { durationMinutes: 480 }),
      ...Array.from({ length: shortCount }, (_, i) =>
        order(`b-${String(i).padStart(3, '0')}`, { durationMinutes: 1 }),
      ),
    ];
    const data = input(orders, [
      center('wc-1', {
        shifts: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startHour: 0,
          endHour: 24,
        })),
      }),
    ]);
    const result = svc.reflow(data);
    expect(result.updatedWorkOrders).toHaveLength(shortCount + 1);
    expect(new Set(result.updatedWorkOrders.map((w) => w.docId)).size).toBe(shortCount + 1);
    const origin = Date.parse(date('08:00'));
    for (let i = 0; i < shortCount; i++) {
      const placed = result.updatedWorkOrders[i + 1];
      expect(placed.docId).toBe(`b-${String(i).padStart(3, '0')}`);
      expect(Date.parse(placed.data.startDate)).toBe(origin + (480 + i) * 60_000);
      expect(Date.parse(placed.data.endDate)).toBe(origin + (481 + i) * 60_000);
    }
    expect(findViolations(data, result.updatedWorkOrders, validateInput(data))).toEqual([]);
    expect(svc.reflow({ ...data, workOrders: [...orders].reverse() }).updatedWorkOrders).toEqual(
      [...result.updatedWorkOrders].reverse(),
    );
  });
  it('prioritizes effective earliest starts rather than original starts', () => {
    const data = input(
      [
        order('parent', { workCenterId: 'wc-2', durationMinutes: 480 }),
        order('child', { dependsOnWorkOrderIds: ['parent'] }),
        order('free', { startDate: date('10:00'), endDate: date('11:00') }),
      ],
      [center(), center('wc-2')],
    );
    const result = svc.reflow(data);
    expect(result.updatedWorkOrders[2].data.startDate).toBe(date('10:00'));
    expect(result.updatedWorkOrders[1].data.startDate).toBe(date('16:00'));
  });
  it('pauses around fixed maintenance and preserves its exact original document', () => {
    const fixed = order('m', {
      startDate: date('11:00'),
      endDate: date('12:00'),
      isMaintenance: true,
    });
    const result = scheduled([
      order('a', { startDate: date('10:00'), endDate: date('13:00'), durationMinutes: 180 }),
      fixed,
    ]);
    expect(result.updatedWorkOrders[0].data).toMatchObject({
      startDate: date('10:00'),
      endDate: date('14:00'),
    });
    expect(result.updatedWorkOrders[1]).toEqual(fixed);
  });
  it('pauses for a maintenance window instead of moving the whole reservation', () => {
    const result = svc.reflow(
      input(
        [order('a', { startDate: date('10:00'), endDate: date('13:00'), durationMinutes: 180 })],
        [
          center('wc-1', {
            maintenanceWindows: [{ startDate: date('11:00'), endDate: date('12:00') }],
          }),
        ],
      ),
    );
    expect(result.updatedWorkOrders[0].data).toMatchObject({
      startDate: date('10:00'),
      endDate: date('14:00'),
    });
    expect(result.changes[0].reasons).toContainEqual(
      expect.objectContaining({ kind: 'maintenanceWindow' }),
    );
  });
  it('resumes after shift breaks without overlapping productive segments', () => {
    const result = scheduled([
      order('a', { startDate: date('16:00'), endDate: date('18:00'), durationMinutes: 120 }),
      order('b', { startDate: date('18:00'), endDate: date('19:00') }),
    ]);
    expect(result.updatedWorkOrders[0].data.endDate).toBe('2026-11-03T09:00:00Z');
    expect(result.updatedWorkOrders[1].data.startDate).toBe('2026-11-03T09:00:00Z');
    expect(result.changes[0].endDeltaMinutes).toBe(900);
    expect(result.changes[0].reasons).toContainEqual(
      expect.objectContaining({ kind: 'shiftBoundary' }),
    );
  });
  it('permits touching reservation boundaries', () => {
    const result = scheduled([
      order(),
      order('m', { isMaintenance: true, startDate: date('09:00'), endDate: date('10:00') }),
    ]);
    expect(result.changes).toEqual([]);
  });
  it('counts setup as working minutes', () => {
    expect(
      scheduled([order('a', { setupTimeMinutes: 30 })]).updatedWorkOrders[0].data.endDate,
    ).toBe(date('09:30'));
  });
  it('does not mutate any input or options', () => {
    const data = input([order('b'), order('a')]);
    const snapshot = structuredClone(data);
    const options = Object.freeze({ maxHorizonDays: 7 });
    svc.reflow(data, options);
    expect(data).toEqual(snapshot);
  });
  it('returns an idempotent valid schedule', () => {
    const data = input([order('b'), order('a')]);
    const result = svc.reflow(data);
    expect(findViolations(data, result.updatedWorkOrders, validateInput(data))).toEqual([]);
    expect(svc.reflow({ ...data, workOrders: result.updatedWorkOrders }).changes).toEqual([]);
  });
  it.each([
    { durationMinutes: 120, endDate: date('08:10') },
    { durationMinutes: 60, setupTimeMinutes: 1, endDate: date('09:00') },
  ])('rejects fixed maintenance that cannot fit its required duration: %j', (fields) => {
    expect(() => scheduled([order('m', { isMaintenance: true, ...fields })])).toThrowError(
      expect.objectContaining({
        code: 'INVALID_INPUT',
        workOrderIds: ['m'],
        message: expect.stringContaining('exceeds the startDate/endDate interval'),
      }),
    );
  });
  it.each(['09:30', '10:00'])('preserves fixed maintenance that fits before %s', (end) => {
    const fixed = order('m', {
      isMaintenance: true,
      durationMinutes: 60,
      setupTimeMinutes: 30,
      endDate: date(end),
    });
    expect(scheduled([fixed]).updatedWorkOrders).toEqual([fixed]);
  });
  it('rejects overlapping fixed maintenance', () => {
    expect(() =>
      scheduled([order('a', { isMaintenance: true }), order('b', { isMaintenance: true })]),
    ).toThrowError(code('MAINTENANCE_CONFLICT'));
  });
  it('rejects a fixed dependency when production cannot finish before maintenance', () => {
    expect(() =>
      scheduled([
        order('a', { durationMinutes: 480 }),
        order('m', {
          isMaintenance: true,
          startDate: date('10:00'),
          endDate: date('11:00'),
          dependsOnWorkOrderIds: ['a'],
        }),
      ]),
    ).toThrowError(
      expect.objectContaining({
        code: 'MAINTENANCE_DEPENDENCY_VIOLATION',
        workOrderIds: ['m', 'a'],
      }),
    );
  });
  it('accepts fixed maintenance outside shifts and honors its children', () => {
    const result = scheduled([
      order('m', {
        isMaintenance: true,
        startDate: '2026-11-01T23:00:00Z',
        endDate: date('10:00'),
      }),
      order('child', { dependsOnWorkOrderIds: ['m'] }),
    ]);
    expect(result.updatedWorkOrders[1].data.startDate).toBe(date('10:00'));
  });
  it('rejects cycles', () => {
    expect(() =>
      scheduled([
        order('a', { dependsOnWorkOrderIds: ['b'] }),
        order('b', { dependsOnWorkOrderIds: ['a'] }),
      ]),
    ).toThrowError(code('CIRCULAR_DEPENDENCY'));
  });
  it('rejects missing centers', () => {
    expect(() => scheduled([order('a', { workCenterId: 'missing' })])).toThrowError(
      code('UNKNOWN_WORK_CENTER'),
    );
  });
  it('rejects missing dependencies', () => {
    expect(() => scheduled([order('a', { dependsOnWorkOrderIds: ['missing'] })])).toThrowError(
      code('UNKNOWN_DEPENDENCY'),
    );
  });
  it('rejects production without shifts', () => {
    expect(() => svc.reflow(input([order()], [center('wc-1', { shifts: [] })]))).toThrowError(
      code('NO_SHIFTS'),
    );
  });
});

describe('search bounds', () => {
  it('rejects null and nonnumeric runtime horizon values', () => {
    for (const value of [null, '365', true]) {
      expect(() =>
        svc.reflow(input(), { maxHorizonDays: value as unknown as number }),
      ).toThrowError(code('INVALID_INPUT'));
    }
  });
  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid horizon %s', (maxHorizonDays) => {
    expect(() => svc.reflow(input(), { maxHorizonDays })).toThrowError(code('INVALID_INPUT'));
  });
  it('rejects two-year blocking but succeeds with a larger horizon', () => {
    const data = input(
      [order()],
      [
        center('wc-1', {
          maintenanceWindows: [{ startDate: date('00:00'), endDate: '2028-11-02T00:00:00Z' }],
        }),
      ],
    );
    expect(() => svc.reflow(data)).toThrowError(code('HORIZON_EXCEEDED'));
    expect(svc.reflow(data, { maxHorizonDays: 800 }).updatedWorkOrders[0].data.endDate).toBe(
      '2028-11-02T09:00:00Z',
    );
  });
  it('requires the whole duration to finish by the deadline', () => {
    expect(() =>
      svc.reflow(input([order('a', { durationMinutes: 1000 })]), { maxHorizonDays: 1 }),
    ).toThrowError(code('HORIZON_EXCEEDED'));
  });
  it('allows exact-deadline completion', () => {
    const data = input(
      [order('a', { durationMinutes: 1440 })],
      [
        center('wc-1', {
          shifts: [1, 2].map((dayOfWeek) => ({ dayOfWeek, startHour: 0, endHour: 24 })),
        }),
      ],
    );
    expect(svc.reflow(data, { maxHorizonDays: 1 }).updatedWorkOrders[0].data.endDate).toBe(
      '2026-11-03T08:00:00Z',
    );
  });
  it('checks dependency bumps against each original deadline', () => {
    const data = input(
      [
        order('parent', {
          startDate: '2026-11-04T08:00:00Z',
          endDate: '2026-11-04T09:00:00Z',
          workCenterId: 'wc-2',
        }),
        order('child', { dependsOnWorkOrderIds: ['parent'] }),
      ],
      [center(), center('wc-2')],
    );
    expect(() => svc.reflow(data, { maxHorizonDays: 1 })).toThrowError(code('HORIZON_EXCEEDED'));
  });
  it('checks conflict bumps and never reserves a still-conflicting candidate', () => {
    const data = input([
      order('m', { isMaintenance: true, endDate: '2026-11-04T10:00:00Z' }),
      order('a'),
    ]);
    expect(() => svc.reflow(data, { maxHorizonDays: 1 })).toThrowError(code('HORIZON_EXCEEDED'));
    const many = input([
      order('m1', { isMaintenance: true }),
      order('m2', { isMaintenance: true, startDate: date('10:00'), endDate: date('11:00') }),
      order('a', { durationMinutes: 120 }),
    ]);
    expect(svc.reflow(many).updatedWorkOrders[2].data).toMatchObject({
      startDate: date('09:00'),
      endDate: date('12:00'),
    });
  });
});
