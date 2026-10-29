import { describe, expect, it, vi } from 'vitest';
import { center, date, input, order } from '../test-fixtures.js';
import * as placement from './placement.js';
import { MAX_BACKTRACK_BRANCHES, reflow } from './reflow.service.js';

describe('bounded fallback and reporting regressions', () => {
  it.each([7, 8, 30])(
    'rejects an impossible root with %i unrelated orders immediately',
    (count) => {
      const spy = vi.spyOn(placement, 'placeOrders');
      try {
        const healthy = Array.from({ length: count }, (_, i) =>
          order(`healthy-${i}`, { workCenterId: 'other' }),
        );
        const data = input(
          [order('bad', { durationMinutes: 600 }), ...healthy],
          [center(), center('other')],
        );
        expect(() => reflow(data, { maxHorizonDays: 1 })).toThrow(
          expect.objectContaining({ code: 'HORIZON_EXCEEDED', workOrderIds: ['bad'] }),
        );
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    },
  );

  it('bounds an ordering-dependent search even when each order fits alone', () => {
    const spy = vi.spyOn(placement, 'placeOrders');
    try {
      const data = input(
        Array.from({ length: 10 }, (_, i) => order(`job-${i}`, { durationMinutes: 120 })),
      );
      expect(() => reflow(data, { maxHorizonDays: 1 })).toThrow(
        expect.objectContaining({ code: 'SEARCH_BUDGET_EXCEEDED' }),
      );
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1 + MAX_BACKTRACK_BRANCHES);
    } finally {
      spy.mockRestore();
    }
  });

  it('normalizes both endpoints when only the end instant changes', () => {
    const result = reflow(
      input([
        order('a', {
          startDate: '2026-11-02T10:00:00+02:00',
          endDate: '2026-11-02T11:00:00+02:00',
          durationMinutes: 120,
        }),
      ]),
    );
    expect(result.updatedWorkOrders[0].data).toMatchObject({
      startDate: date('08:00'),
      endDate: date('10:00'),
    });
    expect(result.changes[0]).toMatchObject({
      newStartDate: date('08:00'),
      newEndDate: date('10:00'),
      startDeltaMinutes: 0,
    });
  });

  it('excludes next-day fixed maintenance from manufacturing completion', () => {
    const data = input([
      order('production'),
      order('maintenance', {
        isMaintenance: true,
        startDate: '2026-11-03T09:00:00Z',
        endDate: '2026-11-03T10:00:00Z',
      }),
    ]);
    expect(reflow(data).lateManufacturingOrders).toEqual([]);
    data.workOrders[0].data.durationMinutes = 600;
    expect(reflow(data).lateManufacturingOrders).toEqual([
      expect.objectContaining({ completionDate: '2026-11-03T09:00:00Z', latenessMinutes: 960 }),
    ]);
  });
});

function deadlineChain(fillers: number) {
  return input(
    [
      order('k'),
      order('k2', { workCenterId: 'other', durationMinutes: 300, dependsOnWorkOrderIds: ['k'] }),
      order('w'),
      ...Array.from({ length: fillers }, (_, i) => order('filler-' + i, { durationMinutes: 20 })),
      order('m-k', {
        isMaintenance: true,
        startDate: date('14:00'),
        endDate: date('15:00'),
        dependsOnWorkOrderIds: ['k2'],
      }),
      order('m-w', {
        isMaintenance: true,
        workCenterId: 'third',
        startDate: date('10:00'),
        endDate: date('11:00'),
        dependsOnWorkOrderIds: ['w'],
      }),
    ],
    [center(), center('other'), center('third')],
  );
}

describe('round-three ordering regressions', () => {
  it.each([3, 6, 10, 20, 40])(
    'solves downstream urgency with %i fillers in one fallback attempt',
    (count) => {
      const spy = vi.spyOn(placement, 'placeOrders');
      try {
        const result = reflow(deadlineChain(count), { maxBacktrackBranches: 1 });
        expect(result.updatedWorkOrders.find((o) => o.docId === 'k')!.data.endDate).toBe(
          date('09:00'),
        );
        expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
      } finally {
        spy.mockRestore();
      }
    },
  );
  it('reports a budget cap on a feasible schedule without claiming infeasibility', () => {
    expect(() => reflow(deadlineChain(6), { maxBacktrackBranches: 0 })).toThrow(
      expect.objectContaining({
        code: 'SEARCH_BUDGET_EXCEEDED',
        message: expect.stringContaining('feasibility is unknown'),
      }),
    );
    expect(() => reflow(deadlineChain(6), { maxBacktrackBranches: 1 })).not.toThrow();
  });
  it('distinguishes proven infeasibility from exhausted ordering alternatives', () => {
    const data = input(
      [
        order('parent', { isMaintenance: true, startDate: date('12:00'), endDate: date('13:00') }),
        order('child', {
          isMaintenance: true,
          workCenterId: 'other',
          startDate: date('10:00'),
          endDate: date('11:00'),
          dependsOnWorkOrderIds: ['parent'],
        }),
      ],
      [center(), center('other')],
    );
    expect(() => reflow(data)).toThrow(
      expect.objectContaining({
        code: 'MAINTENANCE_DEPENDENCY_VIOLATION',
        message: expect.stringContaining('Proven infeasible'),
        workOrderIds: ['child', 'parent'],
      }),
    );
    expect(() =>
      reflow(input([order('a', { durationMinutes: 300 }), order('b', { durationMinutes: 300 })]), {
        maxHorizonDays: 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'ORDERING_SEARCH_EXHAUSTED' }));
  });
  it.each([-1, 1.5, Infinity, NaN])('rejects invalid search budget %s', (budget) => {
    expect(() => reflow(input(), { maxBacktrackBranches: budget })).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    );
  });
});

describe('mixed deadlines and resource isolation', () => {
  it('keeps a horizon-constrained order ahead of a maintenance ancestor', () => {
    const data = deadlineChain(0);
    data.workOrders.find((o) => o.docId === 'w')!.docId = 'a-w';
    data.workOrders.find((o) => o.docId === 'm-w')!.data.dependsOnWorkOrderIds = ['a-w'];
    data.workCenters.push(center('x'), center('mu'));
    data.workOrders.push(
      order('b', {
        workCenterId: 'x',
        startDate: '2026-11-01T09:00:00Z',
        endDate: '2026-11-01T10:00:00Z',
      }),
      order('u', { workCenterId: 'x' }),
      order('mu', {
        workCenterId: 'mu',
        isMaintenance: true,
        startDate: date('12:00'),
        endDate: date('13:00'),
        dependsOnWorkOrderIds: ['u'],
      }),
    );
    const result = reflow(data, { maxHorizonDays: 1 });
    const byId = new Map(result.updatedWorkOrders.map((o) => [o.docId, o.data]));
    expect(byId.get('b')!.endDate).toBe(date('09:00'));
    expect(byId.get('u')!.endDate).toBe(date('10:00'));
    expect(byId.get('k2')!.endDate).toBe(date('14:00'));
  });

  it.each([0, 5, 8])('does not spend fallback choices on %i unrelated orders', (count) => {
    const data = input(
      [
        order('a-root', { durationMinutes: 420 }),
        order('p', { workCenterId: 'p' }),
        order('child', {
          startDate: '2026-11-01T10:00:00Z',
          endDate: '2026-11-01T11:00:00Z',
          dependsOnWorkOrderIds: ['p'],
        }),
        ...Array.from({ length: count }, (_, i) => order('unrelated-' + i, { workCenterId: 'u' })),
      ],
      [center(), center('p'), center('u')],
    );
    const result = reflow(data, { maxHorizonDays: 1, maxBacktrackBranches: 4 });
    expect(result.updatedWorkOrders.find((o) => o.docId === 'child')!.data.endDate).toBe(
      date('10:00'),
    );
    expect(result.updatedWorkOrders.find((o) => o.docId === 'a-root')!.data.endDate).toBe(
      date('17:00'),
    );
  });

  it('retains earlier choices when a later failure involves another resource component', () => {
    const data = input(
      ['a', 'b'].flatMap((id) => [
        order(id + '-root', { workCenterId: id, durationMinutes: 420 }),
        order('p-' + id, { workCenterId: 'parent-' + id }),
        order('child-' + id, {
          workCenterId: id,
          startDate: '2026-11-01T10:00:00Z',
          endDate: '2026-11-01T11:00:00Z',
          dependsOnWorkOrderIds: ['p-' + id],
        }),
      ]),
      ['a', 'b', 'parent-a', 'parent-b'].map((id) => center(id)),
    );
    const result = reflow(data, { maxHorizonDays: 1, maxBacktrackBranches: 8 });
    for (const id of ['a', 'b']) {
      expect(result.updatedWorkOrders.find((o) => o.docId === 'child-' + id)!.data.endDate).toBe(
        date('10:00'),
      );
      expect(result.updatedWorkOrders.find((o) => o.docId === id + '-root')!.data.endDate).toBe(
        date('17:00'),
      );
    }
  });

  it('subtracts setup and calendar pauses when computing latest starts', () => {
    const data = deadlineChain(3);
    const child = data.workOrders.find((o) => o.docId === 'k2')!;
    child.data.durationMinutes = 180;
    child.data.setupTimeMinutes = 60;
    data.workCenters.find((c) => c.docId === 'other')!.data.maintenanceWindows = [
      { startDate: date('10:00'), endDate: date('11:00') },
    ];
    const result = reflow(data, { maxBacktrackBranches: 1 });
    expect(result.updatedWorkOrders.find((o) => o.docId === 'k')!.data.endDate).toBe(date('09:00'));
    expect(result.updatedWorkOrders.find((o) => o.docId === 'k2')!.data.endDate).toBe(
      date('14:00'),
    );
  });

  it('does not traverse unrelated historical dates when computing urgency', () => {
    const data = deadlineChain(3);
    data.workCenters.push(center('history'));
    data.workOrders.push(
      order('old', {
        workCenterId: 'history',
        startDate: '1980-01-07T08:00:00Z',
        endDate: '1980-01-07T09:00:00Z',
      }),
    );
    const result = reflow(data, { maxBacktrackBranches: 1 });
    expect(result.updatedWorkOrders.find((o) => o.docId === 'k2')!.data.endDate).toBe(
      date('14:00'),
    );
    expect(result.updatedWorkOrders.find((o) => o.docId === 'old')).toEqual(data.workOrders.at(-1));
  });
});
