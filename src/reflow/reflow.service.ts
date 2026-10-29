import { findViolations, horizonDays, validateInput } from './constraint-checker.js';
import { assertAcyclic, buildDependencyGraph } from './dependency-graph.js';
import { placeOrders, type IPlacements, type IPlacementSearch } from './placement.js';
import { reportSchedule } from './reporting.js';
import { ReflowError, type IReflowOptions, type IReflowResult } from './types.js';
import {
  calculateEndDateWithShifts,
  workingIntervalsBetween,
  workingMilliseconds,
  forWorkOrder,
  type IInterval,
} from '../utils/date-utils.js';
export { DEFAULT_MAX_HORIZON_DAYS } from '../utils/date-utils.js';

export const MAX_BACKTRACK_BRANCHES = 128;

const isOrderingFailure = (error: unknown): error is ReflowError =>
  error instanceof ReflowError &&
  ['MAINTENANCE_DEPENDENCY_VIOLATION', 'HORIZON_EXCEEDED'].includes(error.code);

/** Validate, place, and report a schedule without mutating caller-owned data. */
export function reflow(payload: unknown, options: IReflowOptions = {}): IReflowResult {
  const maxHorizonDays = horizonDays(options);
  const budget = options.maxBacktrackBranches ?? MAX_BACKTRACK_BRANCHES;
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw new ReflowError(
      'INVALID_INPUT',
      'maxBacktrackBranches must be a nonnegative safe integer',
    );
  const lookup = validateInput(payload);
  const graph = buildDependencyGraph(lookup.input.workOrders);
  const topologicalOrder = assertAcyclic(graph);
  let placements: IPlacements;
  try {
    placements = placeOrders(lookup.input, lookup, graph, maxHorizonDays);
  } catch (error) {
    if (!isOrderingFailure(error)) throw error;
    // An optimistic schedule ignores movable reservations. If it fails, ordering cannot help.
    const earliest = new Map<string, IInterval>();
    for (const id of topologicalOrder) {
      const order = graph.byId.get(id)!;
      const original = lookup.originalIntervals.get(id)!;
      const parents = order.data.dependsOnWorkOrderIds.map((parent) => earliest.get(parent)!.end);
      const start = parents.length ? parents.reduce((a, b) => (a > b ? a : b)) : original.start;
      if (order.data.isMaintenance) {
        if (start > original.start)
          throw new ReflowError(
            'MAINTENANCE_DEPENDENCY_VIOLATION',
            'Proven infeasible: dependencies finish after fixed maintenance ' + id,
            [id, ...order.data.dependsOnWorkOrderIds],
          );
        earliest.set(id, original);
      } else {
        try {
          earliest.set(
            id,
            calculateEndDateWithShifts(
              start,
              order.data.durationMinutes,
              lookup.byId.get(order.data.workCenterId)!.data.shifts,
              lookup.maintenanceIntervals.get(order.data.workCenterId)!,
              original.start.plus({ days: maxHorizonDays }),
              order.data.setupTimeMinutes,
            ),
          );
        } catch (optimisticError) {
          if (isOrderingFailure(optimisticError) && optimisticError.message.includes('iteration'))
            throw new ReflowError(
              optimisticError.code,
              'Optimistic calendar search reached its iteration limit; feasibility is unknown',
              [id],
            );
          if (isOrderingFailure(optimisticError))
            throw new ReflowError(
              optimisticError.code,
              'Proven infeasible within the horizon even without production conflicts: ' + id,
              [id],
            );
          throw optimisticError;
        }
      }
    }
    // Record all candidates so a new failure can change resource scope without
    // discarding the decision prefix. Only conflicting components are advanced.
    const relevantCenters = new Set(lookup.input.workCenters.map((c) => c.docId));
    const ordersByCenter = new Map<string, string[]>();
    for (const order of lookup.input.workOrders) {
      const ids = ordersByCenter.get(order.data.workCenterId) ?? [];
      ids.push(order.docId);
      ordersByCenter.set(order.data.workCenterId, ids);
    }
    function conflictCenters(failure: ReflowError) {
      const centers = new Set<string>();
      const pending = [...failure.workOrderIds];
      const seen = new Set<string>();
      while (pending.length) {
        const id = pending.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const order = graph.byId.get(id)!;
        pending.push(...order.data.dependsOnWorkOrderIds);
        if (!centers.has(order.data.workCenterId)) {
          centers.add(order.data.workCenterId);
          pending.push(...ordersByCenter.get(order.data.workCenterId)!);
        }
      }
      return centers;
    }
    const urgency = latestFinishUrgency();
    /** Propagate latest finishes backward through each child's working calendar,
     * including setup. Fixed maintenance supplies an absolute latest start. */
    function latestFinishUrgency() {
      const finishes = new Map<string, number>();
      const starts = new Map<string, number>();
      for (const id of [...topologicalOrder].reverse()) {
        const order = graph.byId.get(id)!;
        let finish = +lookup.originalIntervals.get(id)!.start.plus({ days: maxHorizonDays });
        for (const child of graph.childrenOf.get(id)!)
          finish = Math.min(finish, starts.get(child) ?? Infinity);
        if (order.data.isMaintenance) {
          starts.set(id, +lookup.originalIntervals.get(id)!.start);
        } else if (Number.isFinite(finish)) {
          finishes.set(id, finish);
          let remaining = workingMilliseconds(
            order.data.durationMinutes,
            order.data.setupTimeMinutes,
          );
          const lower = earliest.get(id)!.start;
          let cursor = lower.plus({ milliseconds: finish - +lower });
          let start = +lower - remaining;
          // Visit only the weeks needed for this order, backward from its deadline.
          // The optimistic earliest start bounds relevant history for this order.
          forWorkOrder(id, () => {
            while (cursor > lower && remaining > 0) {
              const previous = cursor.minus({ days: 7 });
              const from = previous > lower ? previous : lower;
              const blocks = [
                ...workingIntervalsBetween(
                  from,
                  cursor,
                  lookup.byId.get(order.data.workCenterId)!.data.shifts,
                  lookup.maintenanceIntervals.get(order.data.workCenterId)!,
                ),
              ];
              for (const block of blocks.reverse()) {
                const available = +block.end - +block.start;
                if (remaining <= available) {
                  start = +block.end - remaining;
                  remaining = 0;
                  break;
                }
                remaining -= available;
              }
              cursor = from;
            }
          });
          starts.set(id, start);
        }
      }
      return finishes;
    }
    let lastFailure = error;
    let choices: number[] = [];
    for (let branch = 0; ; branch++) {
      if (branch >= budget)
        throw new ReflowError(
          'SEARCH_BUDGET_EXCEEDED',
          'Ordering search reached its ' +
            budget +
            '-attempt budget; feasibility is unknown. Last conflict: ' +
            lastFailure.message,
          lastFailure.workOrderIds,
        );
      const search: IPlacementSearch = { choices, widths: [], candidates: [], relevantCenters };
      try {
        placements = placeOrders(lookup.input, lookup, graph, maxHorizonDays, urgency, search);
        break;
      } catch (retryError) {
        if (!isOrderingFailure(retryError)) throw retryError;
        lastFailure = retryError;
        const centers = conflictCenters(retryError);
        // Advance only decisions within the failing resource/dependency component.
        // Candidate indices remain stable when a later failure involves a new center.
        let depth = search.widths.length - 1;
        let next = -1;
        for (; depth >= 0; depth--) {
          const candidates = search.candidates![depth];
          const current = choices[depth] ?? 0;
          const inConflict = (id: string) => centers.has(graph.byId.get(id)!.data.workCenterId);
          if (!inConflict(candidates[current])) continue;
          next = candidates.findIndex((id, index) => index > current && inConflict(id));
          if (next >= 0) break;
        }
        if (depth < 0)
          throw new ReflowError(
            'ORDERING_SEARCH_EXHAUSTED',
            'Ordering search exhausted supported alternatives; no schedule found. Last conflict: ' +
              retryError.message,
            retryError.workOrderIds,
          );
        choices = Array.from({ length: depth + 1 }, (_, i) => choices[i] ?? 0);
        choices[depth] = next;
      }
    }
  }
  const result = reportSchedule(lookup.input, lookup.originalIntervals, placements);
  const violations = findViolations(lookup.input, result.updatedWorkOrders, lookup, options);
  if (violations.length) {
    throw new ReflowError('SCHEDULE_INVALID', violations.map((v) => v.message).join('; '), [
      ...new Set(violations.flatMap((v) => v.workOrderIds)),
    ]);
  }
  return result;
}

/** Compatibility wrapper for existing callers; new integrations can use the function. */
export class ReflowService {
  reflow(payload: unknown, options: IReflowOptions = {}): IReflowResult {
    return reflow(payload, options);
  }
}
