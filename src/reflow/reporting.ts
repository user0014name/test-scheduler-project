import { minutesBetween, parseUtc, toIso, type IInterval } from '../utils/date-utils.js';
import { formatPlacementReasons } from './placement-reasons.js';
import type { IPlacements } from './placement.js';
import type { IReflowInput, IReflowResult, IScheduleChange } from './types.js';

/** Build independently cloned output and per-invocation change reporting. */
export function reportSchedule(
  input: IReflowInput,
  originalIntervals: Map<string, IInterval>,
  { placedIntervals, reasonsById }: IPlacements,
): IReflowResult {
  // Generate changes in input order and preserve fixed maintenance documents.
  const changes: IScheduleChange[] = [];
  const updatedWorkOrders = input.workOrders.map((order) => {
    const updated = structuredClone(order);
    if (order.data.isMaintenance) {
      return updated;
    }
    const span = placedIntervals.get(order.docId)!;
    const before = originalIntervals.get(order.docId)!;
    // Preserve unchanged documents; normalize both endpoints of changed documents.
    if (+span.start !== +before.start || +span.end !== +before.end) {
      updated.data.startDate = toIso(span.start);
      updated.data.endDate = toIso(span.end);
      changes.push({
        workOrderId: order.docId,
        workOrderNumber: order.data.workOrderNumber,
        workCenterId: order.data.workCenterId,
        originalStartDate: order.data.startDate,
        originalEndDate: order.data.endDate,
        newStartDate: updated.data.startDate,
        newEndDate: updated.data.endDate,
        startDeltaMinutes: minutesBetween(before.start, span.start),
        endDeltaMinutes: minutesBetween(before.end, span.end),
        reasons: formatPlacementReasons(reasonsById.get(order.docId) ?? []),
      });
    }
    return updated;
  });

  // Summarize only orders whose dates changed.
  const metrics = {
    totalDelayMinutes: changes.reduce((sum, c) => sum + c.endDeltaMinutes, 0),
    affectedWorkOrders: changes.length,
  };
  const explanation =
    changes.length === 0
      ? 'Schedule already valid: no changes.'
      : [
          `Reflow rescheduled ${changes.length} of ${input.workOrders.length} work orders (total delay ${metrics.totalDelayMinutes} min).`,
          ...changes.map((change) => {
            const startDelta =
              (change.startDeltaMinutes >= 0 ? '+' : '') + change.startDeltaMinutes;
            const endDelta = (change.endDeltaMinutes >= 0 ? '+' : '') + change.endDeltaMinutes;
            const reasonText =
              change.reasons.map((reason) => reason.message).join('; ') ||
              'end recomputed from working duration including setup';

            return (
              `- ${change.workOrderNumber} (${change.workOrderId}): ` +
              `start ${change.originalStartDate} -> ${change.newStartDate} (${startDelta} min), ` +
              `end ${change.originalEndDate} -> ${change.newEndDate} (${endDelta} min). ` +
              `Reasons: ${reasonText}`
            );
          }),
        ].join('\n');
  // @upgrade Add shift-capacity utilization and idle-time metrics.
  const completionByManufacturingOrder = new Map<string, IInterval['end']>();
  for (const order of updatedWorkOrders) {
    if (order.data.isMaintenance) continue;
    const end = placedIntervals.get(order.docId)!.end;
    const previous = completionByManufacturingOrder.get(order.data.manufacturingOrderId);
    completionByManufacturingOrder.set(
      order.data.manufacturingOrderId,
      previous && previous > end ? previous : end,
    );
  }
  const lateManufacturingOrders: IReflowResult['lateManufacturingOrders'] = [];
  for (const manufacturing of input.manufacturingOrders) {
    const completion = completionByManufacturingOrder.get(manufacturing.docId);
    const due = parseUtc(manufacturing.data.dueDate, manufacturing.docId + '.dueDate');
    if (completion !== undefined && completion > due)
      lateManufacturingOrders.push({
        manufacturingOrderId: manufacturing.docId,
        completionDate: toIso(completion),
        dueDate: manufacturing.data.dueDate,
        latenessMinutes: minutesBetween(due, completion),
      });
  }
  return { updatedWorkOrders, changes, explanation, metrics, lateManufacturingOrders };
}
