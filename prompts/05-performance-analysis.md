# Complexity & Scalability

I'd like to understand the performance implications of the scheduling approaches before adding
optimizations. Help me model time and space complexity in terms of work orders, dependency edges,
work centers, calendar intervals, and placement attempts. Keep the analysis conditional on the
algorithm we choose rather than assuming one implementation.

Separate dependency graph construction and traversal from scheduling costs. If I use a ready
queue, what would repeated sorting cost compared with a priority queue? Could priorities change
as placements are made, and how would that affect caching or heap updates? For reservation
conflicts, compare linear scans, sorted intervals, and interval trees, including insertion and
search costs.

Where might large workloads become expensive: wide dependency graphs, long chains, many competing
orders on one center, sparse shifts, or dense maintenance? Account for calendar recalculation,
final constraint validation, copying input, and storing explanations as well as the main loop.
If an approach uses backtracking or a solver, explain how search limits affect runtime and the
guarantees we can report.

Propose a practical benchmarking and profiling plan with reproducible datasets, warmups, repeated
measurements, memory tracking, and checks that an optimization preserves scheduling behavior.
Which simple improvements would you investigate first? I'd like to distinguish worthwhile changes
from data structures that add maintenance burden without a measured benefit, keeping the initial
timebox and expected workload in mind.
