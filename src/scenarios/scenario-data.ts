import type { IReflowInput, IWorkCenter, IWorkOrder } from '../reflow/types.js';
import { center, order } from '../sample-data.js';

// Keep demonstration dates explicit and independent of the host timezone.
export const timestamp = (day: number, time: string) =>
  `2026-11-${String(day).padStart(2, '0')}T${time}:00Z`;

export function workCenter(id: string): IWorkCenter {
  return center(id, { name: `Extrusion line ${id}` });
}

export function workOrder(
  id: string,
  center: string,
  day: number,
  start: string,
  end: string,
  duration: number,
  dependencies: string[] = [],
): IWorkOrder {
  return order(id, {
    workOrderNumber: id.toUpperCase(),
    manufacturingOrderId: 'mo-pipes',
    workCenterId: center,
    startDate: timestamp(day, start),
    endDate: timestamp(day, end),
    durationMinutes: duration,
    dependsOnWorkOrderIds: dependencies,
  });
}

export function scenarioInput(
  workOrders: IWorkOrder[],
  workCenters = [workCenter('wc-1')],
): IReflowInput {
  return {
    workOrders,
    workCenters,
    manufacturingOrders: [
      {
        docId: 'mo-pipes',
        docType: 'manufacturingOrder',
        data: {
          manufacturingOrderNumber: 'MO-PIPES',
          itemId: 'pipe-100',
          quantity: 1000,
          dueDate: timestamp(10, '17:00'),
        },
      },
    ],
  };
}
