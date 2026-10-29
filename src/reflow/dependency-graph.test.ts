import { expect, it } from 'vitest';
import { order } from '../test-fixtures.js';
import { assertAcyclic, buildDependencyGraph } from './dependency-graph.js';
const wo = (id: string, deps: string[] = []) => order(id, { dependsOnWorkOrderIds: deps });
it('builds children and indegrees for multiple parents', () => {
  const graph = buildDependencyGraph([wo('a'), wo('b', ['a']), wo('c', ['a', 'b'])]);
  expect(graph.childrenOf.get('a')).toEqual(['b', 'c']);
  expect(graph.indegree.get('c')).toBe(2);
  expect(() => assertAcyclic(graph)).not.toThrow();
  expect(graph.indegree.get('c')).toBe(2);
});
it.each([['missing'], ['a']])('rejects unknown or self dependencies %s', (parent) => {
  expect(() => buildDependencyGraph([wo('a', [parent])])).toThrowError(
    expect.objectContaining({ code: 'UNKNOWN_DEPENDENCY', workOrderIds: ['a'] }),
  );
});
it('rejects duplicate ids and dependency ids', () => {
  expect(() => buildDependencyGraph([wo('a'), wo('a')])).toThrowError(
    expect.objectContaining({ code: 'INVALID_INPUT' }),
  );
  expect(() => buildDependencyGraph([wo('a'), wo('b', ['a', 'a'])])).toThrowError(
    expect.objectContaining({ code: 'INVALID_INPUT' }),
  );
});
it('accepts a diamond', () => {
  expect(() =>
    assertAcyclic(
      buildDependencyGraph([wo('a'), wo('b', ['a']), wo('c', ['a']), wo('d', ['b', 'c'])]),
    ),
  ).not.toThrow();
});
it('detects cycles with sorted affected ids', () => {
  expect(() =>
    assertAcyclic(buildDependencyGraph([wo('c', ['b']), wo('a', ['c']), wo('b', ['a']), wo('d')])),
  ).toThrowError(
    expect.objectContaining({ code: 'CIRCULAR_DEPENDENCY', workOrderIds: ['a', 'b', 'c'] }),
  );
});
