import type { DateTime } from 'luxon';
import {
  assertWithinDeadline,
  calculateEndDateWithShifts,
  forWorkOrder,
  minutesBetween,
  toIso,
  workingIntervalsBetween,
  type IInterval,
  type IWorkingSpan,
} from '../utils/date-utils.js';
import { MinHeap } from '../utils/min-heap.js';
import { Reservations } from './reservations.js';
import type { IWorkCenterLookup } from './constraint-checker.js';
import type { IDependencyGraph } from './dependency-graph.js';
import type { PlacementReason } from './placement-reasons.js';
import { ReflowError, type IWorkOrder, type IReflowInput } from './types.js';
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface IPlacements {
  placedIntervals: Map<string, IInterval>;
  reasonsById: Map<string, PlacementReason[]>;
}

/** Replay a decision prefix and record the ready alternatives for backtracking. */
export interface IPlacementSearch {
  choices: readonly number[];
  widths: number[];
  candidates?: string[][];
  relevantCenters: ReadonlySet<string>;
}

/** Place validated orders; queue keys are fixed once all parents have been processed. */
export function placeOrders(
  input: IReflowInput,
  workCenterLookup: IWorkCenterLookup,
  graph: IDependencyGraph,
  maxHorizonDays: number,
  urgency: ReadonlyMap<string, number> = new Map(),
  search?: IPlacementSearch,
): IPlacements {
  const originalIntervals = workCenterLookup.originalIntervals;
  const reservationsByWorkCenter = new Map(
    input.workCenters.map((c) => [
      c.docId,
      new Reservations((end, start) => {
        if (end >= start) return true;
        try {
          return (
            workingIntervalsBetween(
              end,
              start,
              c.data.shifts,
              workCenterLookup.maintenanceIntervals.get(c.docId)!,
            ).next().done === true
          );
        } catch (error) {
          // Failure to prove that a gap is empty must not introduce a new scheduling failure.
          if (error instanceof ReflowError && error.code === 'HORIZON_EXCEEDED') return false;
          throw error;
        }
      }),
    ]),
  );
  const placedIntervals = new Map<string, IInterval>();
  const reasonsById = new Map<string, PlacementReason[]>();

  // Reserve fixed maintenance before scheduling production.
  for (const order of input.workOrders.filter((w) => w.data.isMaintenance)) {
    const interval = originalIntervals.get(order.docId)!;
    const reservations = reservationsByWorkCenter.get(order.data.workCenterId)!;
    const conflict = reservations.firstConflict(interval);
    if (conflict) {
      throw new ReflowError(
        'MAINTENANCE_CONFLICT',
        `Fixed maintenance ${order.docId} overlaps ${conflict.workOrderId}`,
        [order.docId, conflict.workOrderId],
      );
    }
    reservations.add({ interval, workOrderId: order.docId });
    placedIntervals.set(order.docId, interval);
  }

  // Every parent of a ready order must already have a placement.
  // Equal completion times choose the smallest ID for deterministic change reasons.
  const latestParentCompletion = (id: string): { end: DateTime; id: string } | undefined => {
    let latest: { end: DateTime; id: string } | undefined;
    for (const parent of graph.byId.get(id)!.data.dependsOnWorkOrderIds) {
      const interval = placedIntervals.get(parent);
      if (!interval) {
        throw new ReflowError('SCHEDULE_INVALID', `Dependency ${parent} has not been placed`, [
          id,
          parent,
        ]);
      }
      if (
        !latest ||
        interval.end > latest.end ||
        (+interval.end === +latest.end && compareIds(parent, latest.id) < 0)
      ) {
        latest = { end: interval.end, id: parent };
      }
    }
    return latest;
  };

  // A dependent order can pull forward as soon as its parents finish. Roots retain their release date.
  const effectiveStartFor = (id: string): DateTime => {
    const start = originalIntervals.get(id)!.start;
    const parent = latestParentCompletion(id);
    return parent ? parent.end : start;
  };

  // Traverse with Kahn's algorithm using a greedy ready queue.
  // Only orders whose parents have all been processed are eligible for selection.
  const indegree = new Map(graph.indegree);
  interface IReady {
    id: string;
    effectiveStart: number;
    originalStart: number;
  }
  const ready = new MinHeap<IReady>((a, b) => {
    const aDeadline = urgency.get(a.id) ?? Infinity;
    const bDeadline = urgency.get(b.id) ?? Infinity;
    return (
      (aDeadline < bDeadline ? -1 : aDeadline > bDeadline ? 1 : 0) ||
      a.effectiveStart - b.effectiveStart ||
      a.originalStart - b.originalStart ||
      compareIds(a.id, b.id)
    );
  });

  const enqueue = (id: string) =>
    ready.push({
      id,
      effectiveStart: +effectiveStartFor(id),
      originalStart: +originalIntervals.get(id)!.start,
    });
  for (const [id, count] of indegree) if (count === 0) enqueue(id);

  while (ready.size) {
    let selected;
    if (search) {
      const depth = search.widths.length;
      const alternatives: IReady[] = [];
      while (ready.size) alternatives.push(ready.pop()!);
      // Process unrelated queue heads deterministically, without creating branches.
      const candidates = search.relevantCenters.has(
        graph.byId.get(alternatives[0].id)!.data.workCenterId,
      )
        ? alternatives.filter((entry) =>
            search.relevantCenters.has(graph.byId.get(entry.id)!.data.workCenterId),
          )
        : [alternatives[0]];
      search.candidates?.push(candidates.map((entry) => entry.id));
      search.widths.push(candidates.length);
      selected = candidates[search.choices[depth] ?? 0];
      alternatives.splice(alternatives.indexOf(selected), 1);
      for (const alternative of alternatives) ready.push(alternative);
    } else {
      selected = ready.pop()!;
    }
    const { id } = selected;
    const order = graph.byId.get(id)!;
    const start = originalIntervals.get(id)!.start;
    const parent = latestParentCompletion(id);

    // Fixed maintenance is already reserved; only its dependency timing remains to check.
    if (order.data.isMaintenance) {
      if (parent && parent.end > start) {
        throw new ReflowError(
          'MAINTENANCE_DEPENDENCY_VIOLATION',
          `Ordering misses fixed maintenance ${id}: parent ${parent.id} finishes at ${toIso(parent.end)}.`,
          [id, parent.id],
        );
      }
    } else {
      const reservations = reservationsByWorkCenter.get(order.data.workCenterId)!;
      const { span: accepted, reasons } = placeProduction({
        order,
        start,
        parent,
        maxHorizonDays,
        workCenterLookup,
        reservations,
      });
      // Commit placement before unlocking dependent orders.
      placedIntervals.set(id, accepted);
      for (const segment of accepted.segments)
        reservations.add({ interval: segment, workOrderId: id });
      // Formatting and event deduplication happen in reporting.
      reasonsById.set(id, reasons);
    }

    // Unlock a child only after its last parent has been processed.
    for (const child of graph.childrenOf.get(id)!) {
      indegree.set(child, indegree.get(child)! - 1);
      if (indegree.get(child) === 0) {
        enqueue(child);
      }
    }
  }
  return { placedIntervals, reasonsById };
}

interface IProductionContext {
  order: IWorkOrder;
  start: DateTime;
  parent: { end: DateTime; id: string } | undefined;
  maxHorizonDays: number;
  workCenterLookup: IWorkCenterLookup;
  reservations: Reservations;
}

function placeProduction({
  order,
  start,
  parent,
  maxHorizonDays,
  workCenterLookup,
  reservations,
}: IProductionContext) {
  const id = order.docId;
  const center = workCenterLookup.byId.get(order.data.workCenterId)!;
  // Anchor the search horizon to the original start, even after dependency delays.
  const deadline = start.plus({ days: maxHorizonDays });
  if (!deadline.isValid) {
    throw new ReflowError('INVALID_INPUT', `maxHorizonDays exceeds the date range for ${id}`, [id]);
  }
  let earliest = parent ? parent.end : start;
  const reasons: PlacementReason[] = [];
  if (parent && +parent.end !== +start) {
    reasons.push({
      event: 'dependency',
      relatedId: parent.id,
      at: parent.end,
    });
  }

  // Find a shift-aware span, then retry after the first conflicting reservation.
  // Each conflict must advance the candidate; at most every reservation is passed once.
  let accepted: IWorkingSpan | undefined;
  for (let attempt = 0; attempt <= reservations.size; attempt++) {
    forWorkOrder(id, () => assertWithinDeadline(earliest, deadline));
    const span = forWorkOrder(id, () =>
      calculateEndDateWithShifts(
        earliest,
        order.data.durationMinutes,
        center.data.shifts,
        workCenterLookup.maintenanceIntervals.get(center.docId)!,
        deadline,
        order.data.setupTimeMinutes,
      ),
    );
    // Preserve leading calendar reasons across failed placement attempts.
    for (const pause of span.pauses.filter((p) => p.from < span.start)) {
      reasons.push({
        event: pause.kind === 'shift' ? 'leadingShift' : 'leadingMaintenance',
        from: pause.from,
        to: pause.to,
      });
    }

    // Only actual working segments compete for capacity; maintenance remains fixed.
    let conflict;
    for (const segment of span.segments) {
      conflict = reservations.blockingRun(segment);
      if (conflict) break;
    }
    if (!conflict) {
      accepted = span;
      break;
    }
    if (conflict.interval.end <= earliest) {
      throw new ReflowError('SCHEDULE_INVALID', `Conflict placement failed to advance ${id}`, [id]);
    }
    earliest = conflict.interval.end;
    forWorkOrder(id, () => assertWithinDeadline(earliest, deadline));
    reasons.push({
      event: 'resource',
      relatedId: conflict.workOrderId,
      at: earliest,
    });
  }
  if (!accepted) {
    throw new ReflowError(
      'SCHEDULE_INVALID',
      `Conflict search exhausted without a free reservation for ${id}`,
      [id],
    );
  }

  // Only the accepted span contributes pauses after work has started.
  for (const kind of ['shift', 'maintenance'] as const) {
    const paused = accepted.pauses
      .filter((p) => p.kind === kind && p.from > accepted.start)
      .reduce((total, p) => total + minutesBetween(p.from, p.to), 0);
    if (paused) {
      reasons.push({
        event: kind === 'shift' ? 'pausedShift' : 'pausedMaintenance',
        minutes: paused,
      });
    }
  }

  return { span: accepted, reasons };
}
