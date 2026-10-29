import { describe, expect, it } from 'vitest';
import { center, date, input, order } from '../test-fixtures.js';
import { findViolations, validateInput } from './constraint-checker.js';
import type { IReflowInput } from './types.js';

describe('input validation', () => {
  it('returns parsed maintenance intervals', () => {
    const data = input(
      [],
      [
        center('wc-1', {
          maintenanceWindows: [{ startDate: date('11:00'), endDate: date('12:00') }],
        }),
      ],
    );
    expect(validateInput(data).maintenanceIntervals.get('wc-1')![0].start.hour).toBe(11);
  });
  const badCases: [string, (data: IReflowInput) => void][] = [
    [
      'invalid start',
      (d) => {
        d.workOrders[0].data.startDate = 'bad';
      },
    ],
    [
      'invalid end',
      (d) => {
        d.workOrders[0].data.endDate = 'bad';
      },
    ],
    [
      'zero duration',
      (d) => {
        d.workOrders[0].data.durationMinutes = 0;
      },
    ],
    [
      'infinite duration',
      (d) => {
        d.workOrders[0].data.durationMinutes = Infinity;
      },
    ],
    [
      'negative setup',
      (d) => {
        d.workOrders[0].data.setupTimeMinutes = -1;
      },
    ],
    [
      'nan setup',
      (d) => {
        d.workOrders[0].data.setupTimeMinutes = NaN;
      },
    ],
    [
      'invalid shift weekday',
      (d) => {
        d.workCenters[0].data.shifts[0].dayOfWeek = 7;
      },
    ],
    [
      'fractional hour',
      (d) => {
        d.workCenters[0].data.shifts[0].startHour = 8.5;
      },
    ],
    [
      'negative start hour',
      (d) => {
        d.workCenters[0].data.shifts[0].startHour = -1;
      },
    ],
    [
      'end hour too large',
      (d) => {
        d.workCenters[0].data.shifts[0].endHour = 25;
      },
    ],
    [
      'zero-length shift',
      (d) => {
        d.workCenters[0].data.shifts[0].endHour = 8;
      },
    ],
    [
      'overlapping shifts',
      (d) => {
        d.workCenters[0].data.shifts.push({ dayOfWeek: 1, startHour: 9, endHour: 12 });
      },
    ],
    [
      'duplicate centers',
      (d) => {
        d.workCenters.push(center());
      },
    ],
    [
      'empty id',
      (d) => {
        d.workOrders[0].docId = '';
      },
    ],
    [
      'wrong envelope',
      (d) => {
        (d.workOrders[0] as { docType: string }).docType = 'wrong';
      },
    ],
    [
      'invalid window',
      (d) => {
        d.workCenters[0].data.maintenanceWindows = [
          { startDate: date('12:00'), endDate: date('11:00') },
        ];
      },
    ],
    [
      'invalid window date',
      (d) => {
        d.workCenters[0].data.maintenanceWindows = [{ startDate: 'bad', endDate: date('11:00') }];
      },
    ],
    [
      'fixed end before start',
      (d) => {
        d.workOrders[0].data.isMaintenance = true;
        d.workOrders[0].data.endDate = date('07:00');
      },
    ],
  ];
  it.each(badCases)('rejects %s', (_, mutate) => {
    const data = input();
    mutate(data);
    expect(() => validateInput(data)).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    );
  });
  it('rejects malformed runtime payloads with a structured error', () => {
    for (const data of [
      null,
      {},
      { workOrders: [null], workCenters: [], manufacturingOrders: [] },
    ]) {
      expect(() => validateInput(data as unknown as IReflowInput)).toThrowError(
        expect.objectContaining({ code: 'INVALID_INPUT' }),
      );
    }
  });
  it('identifies a missing center', () => {
    expect(() => validateInput(input([order('a', { workCenterId: 'missing' })]))).toThrowError(
      expect.objectContaining({ code: 'UNKNOWN_WORK_CENTER', workOrderIds: ['a'] }),
    );
  });
});
describe('schedule constraints', () => {
  const check = (data: IReflowInput) => findViolations(data, data.workOrders, validateInput(data));
  it('allows touching boundaries', () => {
    expect(
      check(input([order(), order('b', { startDate: date('09:00'), endDate: date('10:00') })])),
    ).toEqual([]);
  });
  it('reports full-span overlap and dependency failures independently', () => {
    const violations = check(
      input([
        order('a', { endDate: date('10:00'), durationMinutes: 120 }),
        order('b', {
          startDate: date('09:00'),
          endDate: date('10:00'),
          dependsOnWorkOrderIds: ['a'],
        }),
      ]),
    );
    expect(violations.map((v) => v.constraint)).toEqual(['workCenterOverlap', 'dependency']);
  });
  it('reports off-shift starts and incorrect working durations', () => {
    expect(
      check(
        input([order('a', { startDate: '2026-11-07T08:00:00Z', endDate: '2026-11-07T09:00:00Z' })]),
      )[0].constraint,
    ).toBe('workingTime');
    expect(
      check(
        input(
          [order('a', { startDate: date('10:00'), endDate: date('13:00'), durationMinutes: 180 })],
          [
            center('wc-1', {
              maintenanceWindows: [{ startDate: date('11:00'), endDate: date('12:00') }],
            }),
          ],
        ),
      )[0].constraint,
    ).toBe('workingTime');
  });
  it('exempts fixed maintenance from shift and capacity checks', () => {
    expect(
      check(
        input(
          [
            order('a', {
              isMaintenance: true,
              startDate: '2026-11-07T08:00:00Z',
              endDate: '2026-11-07T09:00:00Z',
            }),
          ],
          [center('wc-1', { shifts: [] })],
        ),
      ),
    ).toEqual([]);
  });
  it('rejects production without shifts during input validation', () => {
    expect(() => validateInput(input([order()], [center('wc-1', { shifts: [] })]))).toThrowError(
      expect.objectContaining({ code: 'NO_SHIFTS', workOrderIds: ['a'] }),
    );
  });
  it('anchors validation deadlines to original starts', () => {
    const data = input();
    const scheduled = [
      order('a', { startDate: '2028-11-02T08:00:00Z', endDate: '2028-11-02T09:00:00Z' }),
    ];
    expect(findViolations(data, scheduled, validateInput(data))[0].constraint).toBe('workingTime');
    expect(findViolations(data, scheduled, validateInput(data), { maxHorizonDays: 800 })).toEqual(
      [],
    );
  });
});
