import { expect, it } from 'vitest';
import { ReflowError } from './types.js';

it('carries a constraint code, message and affected order ids', () => {
  const error = new ReflowError('CIRCULAR_DEPENDENCY', 'cycle', ['a', 'b']);
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('ReflowError');
  expect(error.code).toBe('CIRCULAR_DEPENDENCY');
  expect(error.message).toBe('cycle');
  expect(error.workOrderIds).toEqual(['a', 'b']);
});
