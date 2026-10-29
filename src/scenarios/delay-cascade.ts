import type { IScenario } from './index.js';
import { scenarioInput, workCenter, workOrder } from './scenario-data.js';

export const delayCascade: IScenario = {
  id: 'delay-cascade',
  title: 'Delay cascade',
  description: 'A four-hour overrun delays two downstream orders across two centers.',
  input: scenarioInput(
    [
      // Eight working hours replace a four-hour planned span to model the overrun.
      workOrder('wo-a', 'wc-1', 2, '08:00', '12:00', 480),
      workOrder('wo-b', 'wc-1', 2, '12:00', '14:00', 120, ['wo-a']),
      workOrder('wo-c', 'wc-2', 2, '14:00', '15:00', 60, ['wo-b']),
      workOrder('wo-d', 'wc-2', 2, '09:00', '11:00', 120),
    ],
    [workCenter('wc-1'), workCenter('wc-2')],
  ),
};
