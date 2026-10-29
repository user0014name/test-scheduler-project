# Production Schedule Reflow

A TypeScript engine for rescheduling manufacturing work orders after duration changes or
resource conflicts. It propagates dependency delays while respecting exclusive work centers,
weekly shifts, maintenance windows, and fixed maintenance orders.

`ReflowService` is synchronous, performs no I/O, and does not mutate its input. The project
includes a scenario CLI and Vitest tests; no server or database is required.

## Setup

Prerequisites: **Node.js 24.x** (`>=24.0.0 <25`) and **npm**. From the repository root:

```sh
npm ci
```

Dependencies are locked in `package-lock.json`. No environment variables or additional
configuration are required. On Windows PowerShell, use `npm.cmd` if execution policy blocks
`npm.ps1`.

## Run

Run all bundled scenarios, a single scenario, or CLI help:

```sh
npm start
npm start -- delay-cascade
npm start -- --help
npm start -- --input schedule.json
```

Available scenario IDs:

| Scenario              | Demonstrates                                                   |
| --------------------- | -------------------------------------------------------------- |
| `delay-cascade`       | An overrun delaying dependent orders across work centers       |
| `shift-boundary`      | Work continuing across overnight and weekend breaks            |
| `maintenance-window`  | Calendar maintenance pauses and fixed maintenance reservations |
| `circular-dependency` | Rejection of a dependency cycle                                |

The CLI prints schedule changes, explanations, and delay metrics. The cycle scenario exits
successfully when its expected error is detected; unknown scenarios and unexpected scheduling
errors return exit code 1. Use `--input schedule.json` to read a complete input snapshot and print a JSON result.
Unexpected failures go to stderr and return exit code 1.

Build and run the compiled ESM entry point:

```sh
npm run build
npm run start:built
npm run start:built -- delay-cascade
```

The build emits JavaScript, declarations, and source maps to `dist/`, excluding tests.

## Tests and checks

```sh
npm test
npm run test:watch
npm run test:coverage
npm run typecheck
npm run lint
npm run format:check
```

Tests cover calendar arithmetic, graph validation, scheduling priorities, conflicts,
maintenance, setup time, input immutability, search bounds, scenario results, and CLI behavior.
ESLint checks TypeScript rules; Prettier checks formatting. To apply fixes, use
`npm run lint:fix` or `npm run format`.

### Input and output

The input contains three arrays of `{ docId, docType, data }` documents:

- `workOrders`: work center and manufacturing order IDs, original start/end timestamps,
  positive `durationMinutes`, optional nonnegative `setupTimeMinutes`, `isMaintenance`, and
  `dependsOnWorkOrderIds`.
- `workCenters`: a name, weekly `shifts`, and dated `maintenanceWindows`.
- `manufacturingOrders`: referenced manufacturing context with unique IDs, positive finite quantity,
  and valid zoned due dates. Due dates are reported as soft targets rather than enforced deadlines.

See [the interfaces](src/reflow/types.ts) for exact fields and
[the delay cascade fixture](src/scenarios/delay-cascade.ts) for a complete example.

The result contains:

| Field                     | Contents                                                                        |
| ------------------------- | ------------------------------------------------------------------------------- |
| `updatedWorkOrders`       | Independently cloned documents in input order, with recomputed production dates |
| `changes`                 | Changed orders, original/new dates, signed minute deltas, and reasons           |
| `explanation`             | Human-readable summary of schedule changes                                      |
| `metrics`                 | `affectedWorkOrders` and `totalDelayMinutes`                                    |
| `lateManufacturingOrders` | Manufacturing completion dates and elapsed-minute lateness after due dates      |

`totalDelayMinutes` sums end-date deltas over changed orders in elapsed minutes. It can be
negative when recomputing an inconsistent original end date. Expected failures throw
`ReflowError` with `code`, `message`, and `workOrderIds`, including input, dependency,
maintenance, and search-limit errors.

## Scheduling approach

The engine uses **Greedy Forward List Scheduling** with a dependency-ready queue. This keeps
placement decisions explicit and reproducible without requiring an optimization solver.

1. **Validate input and build the graph.** Index work orders, create parent-to-child edges,
   and count each order's dependencies. Reject duplicate IDs or dependencies, unknown parents,
   self-references, invalid dates, shifts, durations, and work center references.
2. **Detect cycles with Kahn's algorithm.** Starting with zero-indegree orders, consume edges
   and unlock children. Orders with remaining dependencies indicate a cycle or descendants
   blocked by one. This pass leaves the graph's counts intact for scheduling.
3. **Reserve fixed maintenance.** Place all maintenance orders at their original intervals
   before selecting production work. Reject overlapping fixed reservations.
4. **Select the next eligible order.** A second Kahn traversal admits an order only after all
   parents have been processed. A min-heap uses cached effective earliest start, then original
   start, then lexicographic document ID. Roots retain their original release date; dependent
   orders become eligible at the latest parent completion, allowing them to move earlier.
5. **Find and reserve working segments.** Consume duration plus setup only during shifts,
   pausing outside shifts, within calendar maintenance windows, and around fixed maintenance.
   Reserve only productive segments. If a segment conflicts with another order, advance past
   the blocking busy interval and recompute. Binary searches locate conflicts. Busy runs bridge
   calendar gaps only when those gaps contain no productive time, avoiding repeated searches
   through prior shifts without requiring matching release timestamps or durations.
   Accepted placements unlock children when their final parent is processed. Fixed maintenance
   cannot move; its parents must finish before it starts. If the first policy misses a fixed
   deadline or exhausts its horizon, retry once with ancestors of earlier fixed maintenance
   prioritized. If that also fails, backtrack over ready-order choices until a placement succeeds
   or all ordering branches fail. Each attempt starts with clean reservations.
6. **Validate and report.** Check the completed schedule for work center overlaps, dependency
   timing, root release dates, and working duration. Original metadata remains authoritative;
   candidates may change only start/end dates. Compare dates with the input to generate changes, reasons,
   explanations, and metrics.

Explicit priority and ID tie-breakers make placement deterministic for the same input.

### Constraints and limitations

- **Release dates:** root production orders cannot start before their original start. Dependent
  orders may move earlier when all parents complete. Production end dates are recomputed from working
  duration; represent an overrun by changing `durationMinutes`. All input end dates must follow starts.
- **UTC calendars:** timestamps require an explicit timezone and are normalized to UTC.
  Shifts use Sunday `0` through Saturday `6`, with integer start hours `0-23` and end hours
  `0-24`. An end before the start continues into the next day; `24` also means midnight.
  Weekly validation rejects overlaps across midnight and the Saturday/Sunday boundary.
- **Maintenance semantics:** calendar windows pause production. Fixed maintenance work orders
  remain unchanged, reserve exclusive intervals, and participate in dependencies; they may
  fall outside shifts. Their elapsed interval must accommodate duration plus setup;
  insufficient intervals are rejected with `INVALID_INPUT`. The fixed span is authoritative when longer.
- **Segment reservations:** production occupies only actual working segments; fixed maintenance
  occupies its immutable elapsed interval. Pauses do not reserve capacity for production.
  Intervals are half-open, so one segment may start exactly when another ends.
- **Bounded search:** production must finish by its original start plus `maxHorizonDays`
  (default `365`, a positive finite integer). Each calendar calculation also has a
  10,000-iteration limit. Limit exhaustion does not prove global infeasibility.
- **Ordering search:** successful greedy schedules keep their existing priorities. On failure,
  an optimistic conflict-free pass checks for ordering-independent infeasibility. Fallback priorities
  combine each order's horizon with downstream maintenance deadlines and propagate latest finishes
  backward through working calendars, including setup. Backward traversal visits only the weeks
  needed for each order. Conflict-directed backtracking advances choices within the latest failure's
  resource and dependency component, for both maintenance and horizon misses. Candidate prefixes
  remain stable when a new center is involved; unrelated centers do not consume branch attempts. The fallback permits at most `maxBacktrackBranches`
  placement attempts (default `128`, nonnegative safe integer; `0` disables fallback).
  `SEARCH_BUDGET_EXCEEDED` means feasibility is unknown; `ORDERING_SEARCH_EXHAUSTED` means the
  supported alternatives were exhausted. Proven optimistic failures retain their constraint code
  with an explicit infeasibility message. Search errors identify the latest conflict.
  Search remains heuristic and potentially factorial within the cap; it does not optimize delay
  or explore arbitrary idle times or preemptions. Calendar limits still apply, and manufacturing
  due dates do not affect priorities.
- **Precision:** duration plus setup is rounded up once to whole milliseconds; positive sub-millisecond
  work consumes one millisecond. Duration and setup use exact arithmetic on their decimal
  representations before rounding, so floating-point multiplication or addition cannot add time.
  Timestamps require explicit zones and up to millisecond precision. Unchanged timestamp strings,
  including offsets, are preserved; changed dates use UTC ISO strings.

## Code map

| Path                                              | Responsibility                                           |
| ------------------------------------------------- | -------------------------------------------------------- |
| `src/reflow/reflow.service.ts`                    | Validation, placement/retry, and reporting orchestration |
| `src/reflow/placement.ts`, `reservations.ts`      | Heap-based placement and segment reservation searches    |
| `src/reflow/reporting.ts`, `placement-reasons.ts` | Changes, reason formatting, metrics, and lateness        |
| `src/reflow/dependency-graph.ts`                  | Graph construction and cycle detection                   |
| `src/reflow/constraint-checker.ts`                | Input validation and final constraint checks             |
| `src/reflow/types.ts`                             | Document, result, option, and error types                |
| `src/utils/date-utils.ts`                         | UTC arithmetic and shift-aware working-time calculations |
| `src/cli.ts`, `src/index.ts`                      | Scenario runner and executable entry point               |
| `src/scenarios/`                                  | Sample inputs and regression tests                       |

## Programmatic use

After building, import the side-effect-free API:

```ts
import { reflow, ReflowError } from './dist/api.js';

const result = reflow(input);
```

The package export points at this API, with generated TypeScript declarations. The original
`ReflowService` wrapper remains available for existing integrations. CLI I/O stays outside the engine.

## Verification and performance

The suite includes focused regressions and 40 reproducible generated DAG cases, each with 24
production orders, three centers, maintenance, setup, and split shifts. A separate Date-based
minute-grid oracle checks productive duration and resource occupancy without calling scheduling
helpers; dependency timing, determinism, and immutability are also checked. Generated failures
identify their seed; automatic counterexample shrinking is not implemented.

Run `npm run benchmark` for deterministic wide, chained, and contended workloads, with warmup,
three timed runs, repeatability assertions, and observed heap-use deltas. For profiling, build first
and run `node --cpu-prof scripts/benchmark.mjs 1`. Measurements and review decisions are recorded
in [the review follow-up](docs/review-followup.md). GitHub Actions runs the core verification commands, including V8 coverage.
`npm run test:coverage` also writes an HTML report to `coverage/index.html`.

The six files in `prompts/` are reconstructed development-stage questions, not verified historical
transcripts. Their topics include alternatives and future work; they are not promises that every
option is implemented. UTC calendars are required by the assignment; local-time/DST scheduling,
optimization of affected-order count, utilization metrics, and automatic shrinking remain outside
the implemented scope.

The [five-issue fix report](docs/five-issue-fixes.md) records regression tests and before/after
benchmarks with both identical and distinct release timestamps. An archived built API can be
compared using `node scripts/benchmark.mjs 3 --baseline=path/to/previous/dist/api.js`; dates,
metrics, and lateness must match outside the timed section.
