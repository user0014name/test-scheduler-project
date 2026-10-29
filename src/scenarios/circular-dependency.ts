import type { IScenario } from './index.js';
import { scenarioInput, workOrder } from './scenario-data.js';

export const circularDependency: IScenario = {
  id: 'circular-dependency',
  title: 'Circular dependency',
  description: 'An impossible dependency cycle produces an explicit constraint error.',
  expectedErrorCode: 'CIRCULAR_DEPENDENCY',
  // Neither order can become dependency-ready, so cycle validation must fail.
  input: scenarioInput([
    workOrder('wo-x', 'wc-1', 2, '08:00', '09:00', 60, ['wo-y']),
    workOrder('wo-y', 'wc-1', 2, '09:00', '10:00', 60, ['wo-x']),
  ]),
};
