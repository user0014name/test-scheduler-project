export interface IDocument<TType extends string, TData> {
  docId: string;
  docType: TType;
  data: TData;
}

/** Weekly UTC shift; Sunday is 0. An end before the start continues the next day. */
export interface IShift {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
}

export interface IMaintenanceWindow {
  startDate: string;
  endDate: string;
  reason?: string;
}

export interface IWorkOrderData {
  workOrderNumber: string;
  manufacturingOrderId: string;
  workCenterId: string;
  startDate: string;
  endDate: string;
  // Fixed maintenance uses its original span, which must accommodate duration + setup.
  durationMinutes: number;
  // Setup consumes working minutes under the same calendar as production.
  setupTimeMinutes?: number;
  // Maintenance orders retain their original dates instead of being rescheduled.
  isMaintenance: boolean;
  dependsOnWorkOrderIds: string[];
}

export interface IWorkOrder extends IDocument<'workOrder', IWorkOrderData> {}

export interface IWorkCenterData {
  name: string;
  shifts: IShift[];
  maintenanceWindows: IMaintenanceWindow[];
}

export interface IWorkCenter extends IDocument<'workCenter', IWorkCenterData> {}

export interface IManufacturingOrderData {
  manufacturingOrderNumber: string;
  itemId: string;
  quantity: number;
  dueDate: string;
}

export interface IManufacturingOrder extends IDocument<
  'manufacturingOrder',
  IManufacturingOrderData
> {}
/** Complete scheduling snapshot. Manufacturing orders supply context, not due-date constraints. */
export interface IReflowInput {
  workOrders: IWorkOrder[];
  workCenters: IWorkCenter[];
  manufacturingOrders: IManufacturingOrder[];
}

export interface IReflowOptions {
  // Completion bound measured from each production order's original start; defaults to 365.
  maxHorizonDays?: number;
  // Maximum fallback placement attempts; defaults to 128. Zero disables fallback.
  maxBacktrackBranches?: number;
}

export type ChangeReasonKind =
  'dependency' | 'workCenterConflict' | 'shiftBoundary' | 'maintenanceWindow';

export interface IChangeReason {
  kind: ChangeReasonKind;
  message: string;
  relatedId?: string;
}
/** Signed elapsed-minute deltas relative to the original timestamps. */
export interface IScheduleChange {
  workOrderId: string;
  workOrderNumber: string;
  workCenterId: string;
  originalStartDate: string;
  originalEndDate: string;
  newStartDate: string;
  newEndDate: string;
  startDeltaMinutes: number;
  endDeltaMinutes: number;
  reasons: IChangeReason[];
}

export interface IReflowMetrics {
  totalDelayMinutes: number;
  affectedWorkOrders: number;
}

export interface IReflowResult {
  updatedWorkOrders: IWorkOrder[];
  changes: IScheduleChange[];
  explanation: string;
  metrics: IReflowMetrics;
  lateManufacturingOrders: {
    manufacturingOrderId: string;
    completionDate: string;
    dueDate: string;
    latenessMinutes: number;
  }[];
}

export type ReflowErrorCode =
  | 'INVALID_INPUT'
  | 'UNKNOWN_WORK_CENTER'
  | 'UNKNOWN_DEPENDENCY'
  | 'CIRCULAR_DEPENDENCY'
  | 'NO_SHIFTS'
  | 'MAINTENANCE_CONFLICT'
  | 'MAINTENANCE_DEPENDENCY_VIOLATION'
  | 'HORIZON_EXCEEDED'
  | 'SEARCH_BUDGET_EXCEEDED'
  | 'ORDERING_SEARCH_EXHAUSTED'
  | 'SCHEDULE_INVALID';

export class ReflowError extends Error {
  constructor(
    public readonly code: ReflowErrorCode,
    message: string,
    public readonly workOrderIds: string[] = [],
  ) {
    super(message);
    this.name = 'ReflowError';
  }
}
