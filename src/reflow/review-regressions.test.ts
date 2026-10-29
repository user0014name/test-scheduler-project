import { describe, expect, it } from 'vitest';
import { center, date, input, order } from '../test-fixtures.js';
import { findViolations, validateInput } from './constraint-checker.js';
import { reflow } from './reflow.service.js';

describe('review regressions', () => {
  it('pulls a dependent order forward after all parents complete', () => {
    const data = input([
      order('parent'),
      order('child', {
        startDate: date('15:00'),
        endDate: date('16:00'),
        dependsOnWorkOrderIds: ['parent'],
      }),
    ]);
    const result = reflow(data);
    expect(result.updatedWorkOrders[1].data).toMatchObject({
      startDate: date('09:00'),
      endDate: date('10:00'),
    });
    expect(result.changes[0]).toMatchObject({
      workOrderId: 'child',
      startDeltaMinutes: -360,
      endDeltaMinutes: -360,
    });
    expect(result.changes[0].reasons).toContainEqual(
      expect.objectContaining({ kind: 'dependency', relatedId: 'parent' }),
    );
  });

  it('pauses an eight-hour job for fixed maintenance without moving the whole job', () => {
    const fixed = order('maintenance', {
      isMaintenance: true,
      startDate: date('12:00'),
      endDate: date('13:00'),
    });
    const data = input([order('job', { durationMinutes: 480 }), fixed]);
    const result = reflow(data);
    expect(result.updatedWorkOrders[0].data).toMatchObject({
      startDate: date('08:00'),
      endDate: date('17:00'),
    });
    expect(result.updatedWorkOrders[1]).toEqual(fixed);
    expect(findViolations(data, result.updatedWorkOrders, validateInput(data))).toEqual([]);
    expect(result.changes[0].reasons).toContainEqual(
      expect.objectContaining({ kind: 'maintenanceWindow' }),
    );
  });

  it('permits production spans to overlap fixed maintenance only during its pause', () => {
    const data = input([
      order('job', { endDate: date('12:00'), durationMinutes: 180 }),
      order('maintenance', {
        isMaintenance: true,
        startDate: date('09:00'),
        endDate: date('10:00'),
      }),
    ]);
    expect(findViolations(data, data.workOrders, validateInput(data))).toEqual([]);
  });

  it('schedules through an overnight shift from the previous weekday', () => {
    const data = input(
      [order('a', { startDate: date('02:00'), endDate: date('03:00'), durationMinutes: 90 })],
      [center('wc-1', { shifts: [{ dayOfWeek: 0, startHour: 20, endHour: 6 }] })],
    );
    expect(reflow(data).updatedWorkOrders[0].data.endDate).toBe(date('03:30'));
  });

  it('rejects overnight shift overlaps across the weekly boundary', () => {
    expect(() =>
      reflow(
        input(
          [order()],
          [
            center('wc-1', {
              shifts: [
                { dayOfWeek: 6, startHour: 22, endHour: 6 },
                { dayOfWeek: 0, startHour: 5, endHour: 8 },
              ],
            }),
          ],
        ),
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

  it.each([
    [0.00001, '08:00:00.001'],
    [0.3333, '08:00:19.998'],
    [1 / 7, '08:00:08.572'],
  ])('rounds %s working minutes up to whole milliseconds', (durationMinutes, end) => {
    const data = input([order('a', { durationMinutes })]);
    const result = reflow(data);
    expect(result.updatedWorkOrders[0].data.endDate).toBe(`2026-11-02T${end}Z`);
    expect(findViolations(data, result.updatedWorkOrders, validateInput(data))).toEqual([]);
  });

  it('uses the same rounding once across setup and shift boundaries', () => {
    const data = input([
      order('a', {
        startDate: date('16:59'),
        endDate: date('17:00'),
        durationMinutes: 1.3333,
        setupTimeMinutes: 0.00001,
      }),
    ]);
    expect(reflow(data).updatedWorkOrders[0].data.endDate).toBe('2026-11-03T08:00:19.999Z');
  });

  it.each(['startDate', 'endDate'] as const)('adds the order ID to invalid %s errors', (field) => {
    expect(() => reflow(input([order('a', { [field]: 'bad' })]))).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT', workOrderIds: ['a'] }),
    );
  });

  it('adds the order ID to horizon errors', () => {
    expect(() =>
      reflow(input([order('a', { durationMinutes: 1000 })]), { maxHorizonDays: 1 }),
    ).toThrowError(expect.objectContaining({ code: 'HORIZON_EXCEEDED', workOrderIds: ['a'] }));
  });

  it('rejects reversed production dates', () => {
    expect(() => reflow(input([order('a', { endDate: date('07:00') })]))).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT', workOrderIds: ['a'] }),
    );
  });

  it('preserves unchanged offset timestamp strings and reports no changes', () => {
    const original = order('a', {
      startDate: '2026-11-02T10:00:00+02:00',
      endDate: '2026-11-02T11:00:00+02:00',
    });
    const result = reflow(input([original]));
    expect(result.updatedWorkOrders).toEqual([original]);
    expect(result.changes).toEqual([]);
  });

  it.each([
    'missing reference',
    'invalid due date',
    'negative quantity',
    'duplicate manufacturing ID',
  ])('rejects manufacturing data: %s', (problem) => {
    const data = input();
    if (problem === 'missing reference') data.manufacturingOrders = [];
    if (problem === 'invalid due date') data.manufacturingOrders[0].data.dueDate = 'nonsense';
    if (problem === 'negative quantity') data.manufacturingOrders[0].data.quantity = -5;
    if (problem === 'duplicate manufacturing ID')
      data.manufacturingOrders.push(structuredClone(data.manufacturingOrders[0]));
    expect(() => reflow(data)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

  it('reports lateness without enforcing due dates as hard deadlines', () => {
    const data = input();
    data.manufacturingOrders[0].data.dueDate = date('08:30');
    expect(reflow(data).lateManufacturingOrders).toEqual([
      {
        manufacturingOrderId: 'mo-1',
        completionDate: date('09:00'),
        dueDate: date('08:30'),
        latenessMinutes: 30,
      },
    ]);
  });

  it('retries a missed fixed deadline using maintenance ancestor priority', () => {
    const data = input([
      order('a', { durationMinutes: 90 }),
      order('b'),
      order('m', {
        isMaintenance: true,
        startDate: date('10:00'),
        endDate: date('11:00'),
        dependsOnWorkOrderIds: ['b'],
      }),
    ]);
    const result = reflow(data);
    expect(
      result.updatedWorkOrders.map((w) => [w.docId, w.data.startDate, w.data.endDate]),
    ).toEqual([
      ['a', date('09:00'), date('11:30')],
      ['b', date('08:00'), date('09:00')],
      ['m', date('10:00'), date('11:00')],
    ]);
    expect(findViolations(data, result.updatedWorkOrders, validateInput(data))).toEqual([]);
    expect(reflow(data)).toEqual(result);
  });

  it('rejects unexpected scheduled IDs instead of extending the validation horizon', () => {
    const data = input();
    expect(() => findViolations(data, [order('unknown')], validateInput(data))).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    );
  });

  it('reports all overlapping pairs in an externally supplied schedule', () => {
    const data = input([order('a'), order('b'), order('c')], [center()]);
    const violations = findViolations(data, data.workOrders, validateInput(data));
    expect(violations.filter((v) => v.constraint === 'workCenterOverlap')).toHaveLength(3);
  });
});
