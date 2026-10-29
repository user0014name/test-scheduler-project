import { expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './cli.js';
import { ReflowService } from './reflow/reflow.service.js';
import { ReflowError } from './reflow/types.js';
import { input } from './test-fixtures.js';

const logger = () => ({ log: vi.fn(), error: vi.fn(), table: vi.fn() });

it('sends unexpected domain failures to stderr', () => {
  const output = logger();
  const spy = vi.spyOn(ReflowService.prototype, 'reflow').mockImplementationOnce(() => {
    throw new ReflowError('HORIZON_EXCEEDED', 'cannot place a', ['a']);
  });
  try {
    expect(runCli(['delay-cascade'], output)).toBe(1);
    expect(output.error).toHaveBeenCalledWith('HORIZON_EXCEEDED: cannot place a');
    expect(output.log.mock.calls.flat().join('\n')).not.toContain('HORIZON_EXCEEDED');
  } finally {
    spy.mockRestore();
  }
});

it('reads a JSON input file and emits a machine-readable result', () => {
  const directory = mkdtempSync(join(tmpdir(), 'reflow-cli-'));
  const path = join(directory, 'input.json');
  const output = logger();
  try {
    writeFileSync(path, JSON.stringify(input()));
    expect(runCli(['--input', path], output)).toBe(0);
    const result = JSON.parse(String(output.log.mock.calls[0][0]));
    expect(result.changes).toEqual([]);
    expect(result.updatedWorkOrders).toEqual(input().workOrders);
    expect(output.error).not.toHaveBeenCalled();
    writeFileSync(path, '{ invalid');
    expect(runCli(['--input', path], output)).toBe(1);
    expect(output.error).toHaveBeenCalled();
  } finally {
    unlinkSync(path);
    rmdirSync(directory);
  }
});

it('rejects missing input-file arguments', () => {
  const output = logger();
  expect(runCli(['--input'], output)).toBe(1);
  expect(output.error).toHaveBeenCalledWith('Usage: npm start -- --input schedule.json');
});
