import type { IScenario } from './index.js';
import { scenarioInput, timestamp, workCenter, workOrder } from './scenario-data.js';
// Calendar maintenance pauses production without moving its whole reservation.
const center = workCenter('wc-1');
center.data.maintenanceWindows.push({
  startDate: timestamp(2, '11:00'),
  endDate: timestamp(2, '12:00'),
  reason: 'Die change',
});

// Fixed maintenance remains immutable and pauses any production that spans it.
const fixedMaintenance = workOrder('wo-m', 'wc-1', 3, '08:00', '10:00', 120);
fixedMaintenance.data.isMaintenance = true;

export const maintenanceWindow: IScenario = {
  id: 'maintenance-window',
  title: 'Maintenance window',
  description: 'A calendar window pauses work; a fixed maintenance order stays in place.',
  input: scenarioInput(
    [
      workOrder('wo-h', 'wc-1', 2, '10:00', '13:00', 180),
      workOrder('wo-i', 'wc-1', 2, '11:30', '12:30', 60),
      fixedMaintenance,
      workOrder('wo-j', 'wc-1', 3, '08:00', '09:00', 60),
    ],
    [center],
  ),
};
