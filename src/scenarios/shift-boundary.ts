import type { IScenario } from './index.js';
import { scenarioInput, workOrder } from './scenario-data.js';

export const shiftBoundary: IScenario = {
  id: 'shift-boundary',
  title: 'Shift boundary',
  description: 'Work pauses overnight and through the weekend; reservations stay exclusive.',
  input: scenarioInput([
    workOrder('wo-e', 'wc-1', 2, '16:00', '18:00', 120),
    workOrder('wo-f', 'wc-1', 3, '08:30', '09:30', 60),
    // November 6 is Friday; unfinished work resumes after the weekend.
    workOrder('wo-g', 'wc-1', 6, '15:00', '20:00', 300),
  ]),
};
