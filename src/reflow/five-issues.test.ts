import { describe, expect, it } from 'vitest';
import { center, date, input, order } from '../test-fixtures.js';
import { workingMilliseconds } from '../utils/date-utils.js';
import { findViolations, validateInput } from './constraint-checker.js';
import { reflow } from './reflow.service.js';
import type { IWorkOrderData } from './types.js';

describe('decimal duration precision', () => {
  it.each([
    [0.27, 16_200],
    [0.0041, 246],
    [0.00001, 1],
    [0.000016666666667, 2],
    [1e-10, 1],
    [1 / 7, 8572],
  ])('converts %s minutes without removing genuine fractions', (minutes, expected) => {
    expect(workingMilliseconds(minutes)).toBe(expected);
  });

  it('adds setup in decimal arithmetic before rounding once', () => {
    expect(workingMilliseconds(0.1, 0.2)).toBe(18_000);
    expect(workingMilliseconds(0.00001, 0.00001)).toBe(2);
    expect(() => workingMilliseconds(Number.MAX_VALUE)).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    );
  });

  it('matches exact rational grids for whole and fractional milliseconds', () => {
    for (let i = 1; i <= 1000; i++) {
      expect(workingMilliseconds(i / 10_000)).toBe(i * 6);
      expect(workingMilliseconds(i / 10_000_000)).toBe(Math.floor((i * 6 + 999) / 1000));
    }
  });

  it.each([
    [0.27, 0, '2026-11-02T08:00:16.200Z'],
    [0.1, 0.2, '2026-11-02T08:00:18Z'],
  ])(
    'finishes at a maintenance boundary with duration %s and setup %s',
    (durationMinutes, setupTimeMinutes, endDate) => {
      const data = input(
        [order('a', { durationMinutes, setupTimeMinutes, endDate })],
        [
          center('wc-1', {
            maintenanceWindows: [{ startDate: endDate, endDate: date('09:00') }],
          }),
        ],
      );
      expect(reflow(data).updatedWorkOrders).toEqual(data.workOrders);
      expect(reflow(data).changes).toEqual([]);
    },
  );

  it('still pauses when a genuine fractional millisecond crosses maintenance', () => {
    const endDate = '2026-11-02T08:00:00.001Z';
    const data = input(
      [order('a', { durationMinutes: 0.000016666666667, endDate })],
      [
        center('wc-1', {
          maintenanceWindows: [{ startDate: endDate, endDate: date('09:00') }],
        }),
      ],
    );
    expect(reflow(data).updatedWorkOrders[0].data.endDate).toBe('2026-11-02T09:00:00.001Z');
  });
});

describe('authoritative constraint validation', () => {
  it.each([
    ['12:00', 60, '10:00', '11:00', true],
    ['09:00', 120, '09:00', '10:00', false],
    ['09:00', 60, '09:00', '10:00', false],
  ] as const)(
    'checks supplied intervals ending at %s independently of duration',
    (end, durationMinutes, bStart, bEnd, overlap) => {
      const data = input([
        order('a', { durationMinutes, endDate: date(end) }),
        order('b', { startDate: date(bStart), endDate: date(bEnd) }),
      ]);
      const violations = findViolations(data, data.workOrders, validateInput(data));
      expect(violations.some((v) => v.constraint === 'workCenterOverlap')).toBe(overlap);
      expect(violations.some((v) => v.constraint === 'workingTime')).toBe(
        end !== '09:00' || durationMinutes !== 60,
      );
    },
  );

  it('does not reserve non-working portions of an inconsistent interval', () => {
    const data = input([
      order('a', { durationMinutes: 60, endDate: date('12:00') }),
      order('m', { isMaintenance: true, startDate: date('10:00'), endDate: date('11:00') }),
    ]);
    const violations = findViolations(data, data.workOrders, validateInput(data));
    expect(violations.map((v) => v.constraint)).toEqual(['workingTime']);
  });

  it.each([
    ['durationMinutes', 30],
    ['setupTimeMinutes', 30],
    ['isMaintenance', true],
    ['workCenterId', 'wc-1'],
    ['manufacturingOrderId', 'different'],
    ['workOrderNumber', 'different'],
    ['dependsOnWorkOrderIds', []],
  ] satisfies [keyof IWorkOrderData, unknown][])('rejects modified %s', (field, value) => {
    const data = input(
      [order('p'), order('c', { dependsOnWorkOrderIds: ['p'], workCenterId: 'wc-2' })],
      [center(), center('wc-2')],
    );
    const candidate = structuredClone(data.workOrders);
    Object.assign(candidate[1].data, { [field]: value });
    const before = structuredClone(candidate);
    expect(() => findViolations(data, candidate, validateInput(data))).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT', workOrderIds: ['c'] }),
    );
    expect(candidate).toEqual(before);
  });

  it('cannot turn maintenance into production and move it', () => {
    const data = input([order('m', { isMaintenance: true })]);
    const candidate = [order('m', { startDate: date('09:00'), endDate: date('10:00') })];
    expect(() => findViolations(data, candidate, validateInput(data))).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT', workOrderIds: ['m'] }),
    );
  });

  it('rejects changes to additional nested metadata', () => {
    const original = { ...order(), data: { ...order().data, custom: { priority: 1 } } };
    const data = input([original]);
    const candidate = structuredClone([original]);
    candidate[0].data.custom.priority = 2;
    expect(() => findViolations(data, candidate, validateInput(data))).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    );
  });

  it('enforces a root release date while allowing later dates', () => {
    const data = input([order('a', { startDate: date('12:00'), endDate: date('13:00') })]);
    const lookup = validateInput(data);
    expect(findViolations(data, [order('a')], lookup)).toContainEqual(
      expect.objectContaining({ constraint: 'workingTime', workOrderIds: ['a'] }),
    );
    expect(
      findViolations(
        data,
        [order('a', { startDate: date('13:00'), endDate: date('14:00') })],
        lookup,
      ),
    ).toEqual([]);
  });

  it('allows a dependent to move earlier, but still checks its parents', () => {
    const data = input([
      order('p'),
      order('c', {
        dependsOnWorkOrderIds: ['p'],
        startDate: date('15:00'),
        endDate: date('16:00'),
      }),
    ]);
    const candidate = structuredClone(data.workOrders);
    candidate[1].data.startDate = date('09:00');
    candidate[1].data.endDate = date('10:00');
    expect(findViolations(data, candidate, validateInput(data))).toEqual([]);
    candidate[1].data.startDate = date('08:30');
    candidate[1].data.endDate = date('09:30');
    expect(findViolations(data, candidate, validateInput(data))).toContainEqual(
      expect.objectContaining({ constraint: 'dependency' }),
    );
  });
});
