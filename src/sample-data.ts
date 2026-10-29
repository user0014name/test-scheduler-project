import type { IReflowInput, IWorkCenter, IWorkOrder, IWorkOrderData } from './reflow/types.js';
export const MON_FRI = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startHour: 8,
  endHour: 17,
}));
export const date = (time: string) => `2026-11-02T${time}:00Z`;
export function center(id = 'wc-1', data: Partial<IWorkCenter['data']> = {}): IWorkCenter {
  return {
    docId: id,
    docType: 'workCenter',
    data: { name: id, shifts: structuredClone(MON_FRI), maintenanceWindows: [], ...data },
  };
}
export function order(id = 'a', data: Partial<IWorkOrderData> = {}): IWorkOrder {
  return {
    docId: id,
    docType: 'workOrder',
    data: {
      workOrderNumber: id,
      manufacturingOrderId: 'mo-1',
      workCenterId: 'wc-1',
      startDate: date('08:00'),
      endDate: date('09:00'),
      durationMinutes: 60,
      isMaintenance: false,
      dependsOnWorkOrderIds: [],
      ...data,
    },
  };
}
export function input(
  workOrders: IWorkOrder[] = [order()],
  workCenters: IWorkCenter[] = [center()],
): IReflowInput {
  return {
    workOrders,
    workCenters,
    manufacturingOrders: [
      {
        docId: 'mo-1',
        docType: 'manufacturingOrder',
        data: {
          manufacturingOrderNumber: 'MO-1',
          itemId: 'pipe',
          quantity: 1,
          dueDate: date('17:00'),
        },
      },
    ],
  };
}
