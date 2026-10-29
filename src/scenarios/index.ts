import type { IReflowInput, ReflowErrorCode } from '../reflow/types.js';
import { delayCascade } from './delay-cascade.js';
import { shiftBoundary } from './shift-boundary.js';
import { maintenanceWindow } from './maintenance-window.js';
import { circularDependency } from './circular-dependency.js';

export interface IScenario {
  id: string;
  title: string;
  description: string;
  input: IReflowInput;
  // The CLI treats this failure as a successful demonstration when it matches.
  expectedErrorCode?: ReflowErrorCode;
}

export const scenarios: IScenario[] = [
  delayCascade,
  shiftBoundary,
  maintenanceWindow,
  circularDependency,
];
