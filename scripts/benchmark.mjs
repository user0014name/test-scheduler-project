import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { reflow } from '../dist/api.js';
import { center, input, order, date } from '../dist/sample-data.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const repeats = Number(args.find((arg) => !arg.startsWith('--')) ?? 3);
const baselinePath = args.find((arg) => arg.startsWith('--baseline='))?.slice('--baseline='.length);
const baseline = baselinePath
  ? (await import(pathToFileURL(resolve(baselinePath)).href)).reflow
  : undefined;
if (!Number.isInteger(repeats) || repeats < 1)
  throw new Error('Repetitions must be a positive integer');
const workloads = [
  ...[1000, 2000, 4000].flatMap((count) =>
    [false, true].map((distinct) => ({
      name: distinct ? 'distinct releases / 1 center' : 'identical releases / 1 center',
      count,
      centers: 1,
      chained: false,
      distinct,
    })),
  ),
  { name: 'wide / 5 centers', count: 5000, centers: 5, chained: false },
  { name: 'chain / 5 centers', count: 2000, centers: 5, chained: true },
  { name: 'wide / 1 center', count: 2000, centers: 1, chained: false },
];

console.log(
  `Node ${process.version}; ${process.platform}/${process.arch}; ${repeats} timed runs after warmup`,
);
for (const workload of workloads) {
  const data = input(
    Array.from({ length: workload.count }, (_, i) =>
      order(`job-${String(i).padStart(5, '0')}`, {
        workCenterId: `wc-${i % workload.centers}`,
        durationMinutes: 20,
        startDate: new Date(Date.parse(date('08:00')) + (workload.distinct ? i : 0)).toISOString(),
        endDate: new Date(Date.parse(date('09:00')) + (workload.distinct ? i : 0)).toISOString(),
        dependsOnWorkOrderIds:
          workload.chained && i ? [`job-${String(i - 1).padStart(5, '0')}`] : [],
      }),
    ),
    Array.from({ length: workload.centers }, (_, i) => center(`wc-${i}`)),
  );
  const snapshot = structuredClone(data);
  const expected = reflow(data);
  if (baseline) {
    const before = baseline(data);
    assert.deepEqual(expected.updatedWorkOrders, before.updatedWorkOrders);
    assert.deepEqual(expected.metrics, before.metrics);
    assert.deepEqual(expected.lateManufacturingOrders, before.lateManufacturingOrders);
  }
  const timings = [];
  let heapDelta = 0;
  for (let run = 0; run < repeats; run++) {
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();
    const result = reflow(data);
    timings.push(performance.now() - start);
    heapDelta = Math.max(heapDelta, process.memoryUsage().heapUsed - heapBefore);
    assert.deepEqual(result, expected);
    assert.deepEqual(data, snapshot);
  }
  timings.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      workload: workload.name,
      orders: workload.count,
      minMs: Math.round(timings[0]),
      medianMs: Math.round(timings[Math.floor(repeats / 2)]),
      maxMs: Math.round(timings.at(-1)),
      maxObservedHeapDeltaMiB: +(heapDelta / 1024 ** 2).toFixed(1),
    }),
  );
}
