import { ReflowService } from './reflow/reflow.service.js';
import { ReflowError } from './reflow/types.js';
import { scenarios } from './scenarios/index.js';
import { readFileSync } from 'node:fs';

export function runCli(
  args: string[],
  output: Pick<Console, 'log' | 'error' | 'table'> = console,
): number {
  // Handle help before validating scenario arguments.
  const scenarioId = args[0];
  if (scenarioId === '--input') {
    if (args.length !== 2) {
      output.error('Usage: npm start -- --input schedule.json');
      return 1;
    }
    try {
      const payload: unknown = JSON.parse(readFileSync(args[1], 'utf8').replace(/^\uFEFF/, ''));
      output.log(JSON.stringify(new ReflowService().reflow(payload), null, 2));
      return 0;
    } catch (error) {
      if (error instanceof ReflowError)
        output.error(`${error.code}: ${error.message} [${error.workOrderIds.join(', ')}]`);
      else if (error instanceof SyntaxError || (error instanceof Error && 'code' in error))
        output.error(error.message);
      else throw error;
      return 1;
    }
  }
  if (scenarioId === '--help' || scenarioId === '-h') {
    output.log(
      `Usage: npm start -- [scenario-id] | --input schedule.json\nScenarios: ${scenarios.map((scenario) => scenario.id).join(', ')}`,
    );
    return 0;
  }

  // Keep the registry order when running the complete demonstration.
  const selectedScenarios = scenarioId
    ? scenarios.filter((scenario) => scenario.id === scenarioId)
    : scenarios;
  if (!selectedScenarios.length || args.length > 1) {
    output.error(
      `Unknown scenario or extra arguments. Available: ${scenarios.map((scenario) => scenario.id).join(', ')}`,
    );
    return 1;
  }

  let exitCode = 0;
  for (const scenario of selectedScenarios) {
    output.log(`\n=== ${scenario.title} ===`);
    output.log(scenario.description);

    try {
      const result = new ReflowService().reflow(scenario.input);
      output.table(
        result.changes.map((change) => ({
          workOrder: change.workOrderNumber,
          from: change.originalStartDate,
          to: change.newStartDate,
          startDeltaMinutes: change.startDeltaMinutes,
          endDeltaMinutes: change.endDeltaMinutes,
        })),
      );
      output.log(result.explanation);
      output.log(
        `Metrics: total delay ${result.metrics.totalDelayMinutes} min; affected work orders ${result.metrics.affectedWorkOrders}`,
      );

      // An error scenario passes only when it produces its declared failure.
      if (scenario.expectedErrorCode) {
        output.error(`Expected ${scenario.expectedErrorCode} but scheduling succeeded`);
        exitCode = 1;
      }
    } catch (error) {
      if (!(error instanceof ReflowError)) {
        throw error;
      }
      // Unexpected exceptions propagate; expected domain errors can be demonstrated.
      if (error.code === scenario.expectedErrorCode) output.log(error.code + ': ' + error.message);
      else {
        output.error(error.code + ': ' + error.message);
        exitCode = 1;
      }
    }
  }
  return exitCode;
}
