import { expect, it, vi } from 'vitest';
import { runCli } from './cli.js';
const cli = (...args: string[]) => {
  const output: string[] = [];
  const logger = {
    log: vi.fn((value: unknown) => output.push(String(value))),
    error: vi.fn(),
    table: vi.fn(),
  };
  const status = runCli(args, logger);
  return { status, stdout: output.join('\n') };
};
it('runs all four scenarios with the expected failure treated as a successful demonstration', () => {
  const result = cli();
  expect(result.status).toBe(0);
  for (const title of [
    'Delay cascade',
    'Shift boundary',
    'Maintenance window',
    'Circular dependency',
  ])
    expect(result.stdout).toContain(`=== ${title} ===`);
  expect(result.stdout).toContain('total delay 2520 min');
  expect(result.stdout).toContain('CIRCULAR_DEPENDENCY');
});
it('filters by id and rejects unknown ids', () => {
  const result = cli('circular-dependency');
  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain('=== Delay cascade ===');
  expect(cli('missing').status).toBe(1);
});
