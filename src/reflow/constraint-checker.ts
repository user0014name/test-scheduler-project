import { isDeepStrictEqual } from 'node:util';
import {
  calculateEndDateWithShifts,
  intervalsOverlap,
  forWorkOrder,
  forWorkOrders,
  workingMilliseconds,
  workingIntervalsBetween,
  DEFAULT_MAX_HORIZON_DAYS,
  parseUtc,
  toIso,
  type IInterval,
} from '../utils/date-utils.js';
import {
  ReflowError,
  type IReflowInput,
  type IReflowOptions,
  type IWorkCenter,
  type IWorkOrder,
} from './types.js';

export type ViolatedConstraint = 'workCenterOverlap' | 'dependency' | 'workingTime';

export interface IConstraintViolation {
  constraint: ViolatedConstraint;
  workOrderIds: string[];
  message: string;
}

export interface IWorkCenterLookup {
  byId: Map<string, IWorkCenter>;
  maintenanceIntervals: Map<string, IInterval[]>;
  originalIntervals: Map<string, IInterval>;
  input: IReflowInput;
}

export { DEFAULT_MAX_HORIZON_DAYS } from '../utils/date-utils.js';

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new ReflowError('INVALID_INPUT', message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function envelope(value: unknown, type: string): void {
  requireValid(
    isRecord(value) && nonempty(value.docId) && value.docType === type && isRecord(value.data),
    `Invalid ${type} document envelope`,
  );
}

export function horizonDays(options: IReflowOptions = {}): number {
  requireValid(isRecord(options), 'Options must be an object');

  // Default only when omitted; reject explicit null and other invalid runtime values.
  const value =
    options.maxHorizonDays === undefined ? DEFAULT_MAX_HORIZON_DAYS : options.maxHorizonDays;
  requireValid(
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0,
    'maxHorizonDays must be a positive finite integer',
  );
  return value;
}

export function validateInput(payload: unknown): IWorkCenterLookup {
  const input = payload as IReflowInput;
  requireValid(
    isRecord(input) &&
      Array.isArray(input.workOrders) &&
      Array.isArray(input.workCenters) &&
      Array.isArray(input.manufacturingOrders),
    'Input must contain workOrders, workCenters and manufacturingOrders arrays',
  );

  const ordersByCenter = new Map<string, string[]>();
  const ordersByManufacturing = new Map<string, string[]>();
  for (const order of input.workOrders) {
    envelope(order, 'workOrder');
    for (const [map, key] of [
      [ordersByCenter, order.data.workCenterId],
      [ordersByManufacturing, order.data.manufacturingOrderId],
    ] as const) {
      if (typeof key === 'string') {
        const ids = map.get(key) ?? [];
        ids.push(order.docId);
        map.set(key, ids);
      }
    }
  }
  // Validate calendars before work orders so center lookups are safe during scheduling.
  const byId = new Map<string, IWorkCenter>();
  const maintenanceIntervals = new Map<string, IInterval[]>();
  const originalIntervals = new Map<string, IInterval>();
  for (const center of input.workCenters) {
    envelope(center, 'workCenter');
    forWorkOrders(ordersByCenter.get(center.docId) ?? [], () => {
      requireValid(!byId.has(center.docId), `Duplicate work center ${center.docId}`);
      const data = center.data;
      requireValid(
        nonempty(data.name) && Array.isArray(data.shifts) && Array.isArray(data.maintenanceWindows),
        `Invalid work center ${center.docId}`,
      );

      // Integer-hour UTC shifts may cross midnight; endHour 24 also represents midnight.
      for (const shift of data.shifts) {
        requireValid(
          isRecord(shift) &&
            Number.isInteger(shift.dayOfWeek) &&
            shift.dayOfWeek >= 0 &&
            shift.dayOfWeek <= 6 &&
            Number.isInteger(shift.startHour) &&
            shift.startHour >= 0 &&
            shift.startHour <= 23 &&
            Number.isInteger(shift.endHour) &&
            shift.endHour >= 0 &&
            shift.endHour <= 24 &&
            shift.startHour !== shift.endHour,
          `Invalid shift on ${center.docId}`,
        );
      }

      // Compare intervals on a repeating week, including Sunday-to-Monday wraparound.
      const blocks = data.shifts.map((shift) => ({
        start: shift.dayOfWeek * 24 + shift.startHour,
        end: shift.dayOfWeek * 24 + shift.endHour + (shift.endHour <= shift.startHour ? 24 : 0),
      }));
      for (let i = 0; i < blocks.length; i++)
        for (let j = i + 1; j < blocks.length; j++) {
          for (const offset of [-168, 0, 168])
            requireValid(
              blocks[i].start >= blocks[j].end + offset ||
                blocks[j].start + offset >= blocks[i].end,
              'Overlapping shifts on ' + center.docId,
            );
        }

      const maintenanceWindows = data.maintenanceWindows.map((window) => {
        requireValid(isRecord(window), `Invalid maintenance window on ${center.docId}`);
        const start = parseUtc(window.startDate, `${center.docId}.maintenance.startDate`);
        const end = parseUtc(window.endDate, `${center.docId}.maintenance.endDate`);
        requireValid(start < end, `Maintenance window on ${center.docId} must end after it starts`);
        return { start, end };
      });
      byId.set(center.docId, center);
      maintenanceIntervals.set(center.docId, maintenanceWindows);
    });
  }

  // Check work order fields without requiring production end dates to match duration.
  // Reflow recomputes production ends; only fixed maintenance must retain a valid span.
  const manufacturingIds = new Set<string>();
  for (const manufacturing of input.manufacturingOrders) {
    envelope(manufacturing, 'manufacturingOrder');
    const ids = ordersByManufacturing.get(manufacturing.docId) ?? [];
    forWorkOrders(ids, () => {
      requireValid(
        !manufacturingIds.has(manufacturing.docId),
        'Duplicate manufacturing order ' + manufacturing.docId,
      );
      manufacturingIds.add(manufacturing.docId);
      requireValid(
        nonempty(manufacturing.data.manufacturingOrderNumber) &&
          nonempty(manufacturing.data.itemId) &&
          Number.isFinite(manufacturing.data.quantity) &&
          manufacturing.data.quantity > 0,
        'Invalid manufacturing order ' + manufacturing.docId,
      );
      try {
        parseUtc(manufacturing.data.dueDate, manufacturing.docId + '.dueDate');
      } catch (error) {
        if (error instanceof ReflowError) throw new ReflowError(error.code, error.message, ids);
        throw error;
      }
    });
  }
  const orderIds = new Set<string>();
  for (const order of input.workOrders) {
    envelope(order, 'workOrder');
    requireValid(!orderIds.has(order.docId), `Duplicate work order ${order.docId}`);
    orderIds.add(order.docId);
    forWorkOrder(order.docId, () => {
      const data = order.data;
      requireValid(
        nonempty(data.workOrderNumber) &&
          nonempty(data.manufacturingOrderId) &&
          nonempty(data.workCenterId) &&
          typeof data.isMaintenance === 'boolean' &&
          Array.isArray(data.dependsOnWorkOrderIds) &&
          data.dependsOnWorkOrderIds.every(nonempty),
        `Invalid work order ${order.docId}`,
      );

      const start = parseUtc(data.startDate, `${order.docId}.startDate`);
      const end = parseUtc(data.endDate, `${order.docId}.endDate`);
      requireValid(
        Number.isFinite(data.durationMinutes) && data.durationMinutes > 0,
        `Invalid durationMinutes on ${order.docId}`,
      );
      requireValid(
        data.setupTimeMinutes === undefined ||
          (Number.isFinite(data.setupTimeMinutes) && data.setupTimeMinutes >= 0),
        `Invalid setupTimeMinutes on ${order.docId}`,
      );
      // Finite components can still overflow when combined.
      requireValid(
        Number.isFinite(data.durationMinutes + (data.setupTimeMinutes ?? 0)),
        `Total working duration overflows on ${order.docId}`,
      );
      requireValid(end > start, `Work order ${order.docId} must end after it starts`);
      const requiredMilliseconds = workingMilliseconds(data.durationMinutes, data.setupTimeMinutes);
      if (data.isMaintenance) {
        requireValid(
          +end - +start >= requiredMilliseconds,
          `Fixed maintenance ${order.docId}: durationMinutes plus setupTimeMinutes exceeds the startDate/endDate interval`,
        );
      }
      originalIntervals.set(order.docId, { start, end });
      if (!manufacturingIds.has(data.manufacturingOrderId)) {
        throw new ReflowError(
          'INVALID_INPUT',
          'Unknown manufacturing order ' + data.manufacturingOrderId,
          [order.docId],
        );
      }
      if (!byId.has(data.workCenterId)) {
        throw new ReflowError(
          'UNKNOWN_WORK_CENTER',
          `Work order ${order.docId} references unknown work center ${data.workCenterId}`,
          [order.docId],
        );
      }
      if (!data.isMaintenance && !byId.get(data.workCenterId)!.data.shifts.length) {
        throw new ReflowError('NO_SHIFTS', 'Production requires work-center shifts', [order.docId]);
      }
    });
  }

  // Fixed maintenance blocks productive execution just like a calendar interruption.
  for (const order of input.workOrders)
    if (order.data.isMaintenance) {
      maintenanceIntervals.get(order.data.workCenterId)!.push(originalIntervals.get(order.docId)!);
    }
  return { byId, maintenanceIntervals, originalIntervals, input };
}

export function findViolations(
  input: IReflowInput,
  scheduled: IWorkOrder[],
  lookup: IWorkCenterLookup,
  options: IReflowOptions = {},
): IConstraintViolation[] {
  const maxHorizonDays = horizonDays(options);
  const violations: IConstraintViolation[] = [];
  const originalOrders = new Map(input.workOrders.map((order) => [order.docId, order]));
  for (const order of scheduled) envelope(order, 'workOrder');
  requireValid(
    scheduled.length === input.workOrders.length &&
      new Set(scheduled.map((w) => w.docId)).size === scheduled.length &&
      scheduled.every((w) => originalOrders.has(w.docId)),
    'Scheduled orders must match input IDs exactly',
  );
  // Only dates may change; the original document defines every scheduling constraint.
  const metadata = (order: IWorkOrder) => ({
    ...order,
    data: Object.fromEntries(
      Object.entries(order.data).filter(([key]) => key !== 'startDate' && key !== 'endDate'),
    ),
  });
  for (const order of scheduled) {
    forWorkOrder(order.docId, () =>
      requireValid(
        isDeepStrictEqual(metadata(order), metadata(originalOrders.get(order.docId)!)),
        'Immutable scheduling metadata changed on ' + order.docId,
      ),
    );
  }
  const intervals = new Map(
    scheduled.map((order) => [
      order.docId,
      {
        start: parseUtc(order.data.startDate, `${order.docId}.startDate`),
        end: parseUtc(order.data.endDate, `${order.docId}.endDate`),
      },
    ]),
  );

  const executionById = new Map<string, IInterval[]>();
  // For each order, check dependencies before validating production working time.
  for (const order of scheduled) {
    const span = intervals.get(order.docId)!;
    const original = originalOrders.get(order.docId)!;
    forWorkOrder(order.docId, () =>
      requireValid(span.start < span.end, 'Scheduled end must follow start on ' + order.docId),
    );
    for (const parentId of original.data.dependsOnWorkOrderIds) {
      const parent = intervals.get(parentId);
      if (!parent || span.start < parent.end) {
        violations.push({
          constraint: 'dependency',
          workOrderIds: [order.docId, parentId],
          message: `${order.docId} does not follow ${parentId}`,
        });
      }
    }

    // Fixed reservations still obey dependencies, but need not follow working calendars.
    if (original.data.isMaintenance) {
      requireValid(
        order.data.startDate === originalOrders.get(order.docId)!.data.startDate &&
          order.data.endDate === originalOrders.get(order.docId)!.data.endDate,
        'Fixed maintenance cannot move',
      );
      executionById.set(order.docId, [span]);
      continue;
    }

    const center = lookup.byId.get(original.data.workCenterId)!;
    const originalStart = lookup.originalIntervals.get(order.docId)!.start;
    if (!original.data.dependsOnWorkOrderIds.length && span.start < originalStart)
      violations.push({
        constraint: 'workingTime',
        workOrderIds: [order.docId],
        message: order.docId + ' starts before its original release date',
      });
    // Occupancy depends only on the supplied dates. If its bounded calendar traversal fails,
    // reject explicitly rather than inventing full-span occupancy across non-working pauses.
    executionById.set(
      order.docId,
      forWorkOrder(order.docId, () => [
        ...workingIntervalsBetween(
          span.start,
          span.end,
          center.data.shifts,
          lookup.maintenanceIntervals.get(center.docId)!,
        ),
      ]),
    );
    try {
      const expected = calculateEndDateWithShifts(
        span.start,
        original.data.durationMinutes,
        center.data.shifts,
        lookup.maintenanceIntervals.get(center.docId)!,
        originalStart.plus({ days: maxHorizonDays }),
        original.data.setupTimeMinutes,
      );
      if (+expected.start !== +span.start || +expected.end !== +span.end) {
        violations.push({
          constraint: 'workingTime',
          workOrderIds: [order.docId],
          message: `${order.docId} expected ${toIso(expected.start)} to ${toIso(expected.end)}`,
        });
      }
    } catch (error) {
      if (!(error instanceof ReflowError)) {
        throw error;
      }
      // Report domain failures alongside other violations; propagate unexpected errors.
      violations.push({
        constraint: 'workingTime',
        workOrderIds: [order.docId],
        message: `${order.docId}: ${error.code}: ${error.message}`,
      });
    }
  }
  // Elapsed spans may overlap during pauses; only productive segments reserve capacity.
  const groups = new Map<string, { id: string; span: IInterval }[]>();
  for (const order of scheduled) {
    const group = groups.get(order.data.workCenterId) ?? [];
    for (const span of executionById.get(order.docId)!) group.push({ id: order.docId, span });
    groups.set(order.data.workCenterId, group);
  }
  const overlaps: IConstraintViolation[] = [];
  const seen = new Set<string>();
  for (const group of groups.values()) {
    group.sort((a, b) => +a.span.start - +b.span.start);
    let active: typeof group = [];
    for (const current of group) {
      active = active.filter((other) => other.span.end > current.span.start);
      for (const other of active) {
        const ids = [other.id, current.id].sort();
        const key = JSON.stringify(ids);
        if (
          other.id !== current.id &&
          !seen.has(key) &&
          intervalsOverlap(current.span, other.span)
        ) {
          seen.add(key);
          overlaps.push({
            constraint: 'workCenterOverlap',
            workOrderIds: [other.id, current.id],
            message: other.id + ' overlaps ' + current.id,
          });
        }
      }
      active.push(current);
    }
  }
  return [...overlaps, ...violations];
}
