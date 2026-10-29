import { ReflowError, type IWorkOrder } from './types.js';

export interface IDependencyGraph {
  byId: Map<string, IWorkOrder>;
  childrenOf: Map<string, string[]>;
  indegree: Map<string, number>;
}

// Build parent-to-child edges; cycle detection is a separate validation pass.
export function buildDependencyGraph(workOrders: IWorkOrder[]): IDependencyGraph {
  const byId = new Map<string, IWorkOrder>();

  // Index every order first so references may point forward in the input.
  for (const order of workOrders) {
    if (byId.has(order.docId)) {
      throw new ReflowError('INVALID_INPUT', `Duplicate work order ${order.docId}`, [order.docId]);
    }
    byId.set(order.docId, order);
  }

  const childrenOf = new Map(workOrders.map((order) => [order.docId, [] as string[]]));
  // Indegree counts parents; child edges let traversal unlock dependents.
  const indegree = new Map<string, number>();

  // Reject duplicate edges so each parent decrements its child exactly once.
  for (const order of workOrders) {
    const parentIds = order.data.dependsOnWorkOrderIds;
    if (new Set(parentIds).size !== parentIds.length) {
      throw new ReflowError('INVALID_INPUT', `Duplicate dependencies on ${order.docId}`, [
        order.docId,
      ]);
    }

    indegree.set(order.docId, parentIds.length);
    for (const parentId of parentIds) {
      if (parentId === order.docId || !byId.has(parentId)) {
        throw new ReflowError(
          'UNKNOWN_DEPENDENCY',
          `Work order ${order.docId} depends on unknown work order ${parentId} (self references are not allowed)`,
          [order.docId],
        );
      }
      childrenOf.get(parentId)!.push(order.docId);
    }
  }
  return { byId, childrenOf, indegree };
}

// Asserts that the given dependency graph is acyclic. Throws ReflowError if a cycle is detected.
export function assertAcyclic(graph: IDependencyGraph): string[] {
  // Kahn's traversal consumes a copy, leaving graph indegrees intact for scheduling.
  const remainingParents = new Map(graph.indegree);
  const readyOrderIds = [...remainingParents]
    .filter(([, unresolvedParents]) => unresolvedParents === 0)
    .map(([id]) => id);

  // The array doubles as a queue: newly unblocked children are appended once.
  for (let i = 0; i < readyOrderIds.length; i++) {
    const parentId = readyOrderIds[i];
    for (const childId of graph.childrenOf.get(parentId)!) {
      remainingParents.set(childId, remainingParents.get(childId)! - 1);
      if (remainingParents.get(childId) === 0) {
        readyOrderIds.push(childId);
      }
    }
  }

  // Remaining orders include cycle members and dependents blocked by a cycle.
  // Sort IDs to keep the diagnostic independent of traversal order.
  const blocked = [...remainingParents]
    .filter(([, degree]) => degree > 0)
    .map(([id]) => id)
    .sort();
  if (blocked.length) {
    throw new ReflowError(
      'CIRCULAR_DEPENDENCY',
      `Circular dependency between work orders: ${blocked.join(', ')}`,
      blocked,
    );
  }
  return readyOrderIds;
}
