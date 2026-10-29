# Working Calendars & Resource Allocation

I need a reliable way to turn working durations into feasible execution times and allocate shared
work centers. Please help me design the mechanism before writing code.

An order needing 120 minutes that starts Monday at 16:00 under weekday 08:00-17:00 shifts should
finish Tuesday at 09:00. How should I generalize that calculation to breaks, overnight shifts,
weekends, multi-day operations, and maintenance interruptions? If I include optional setup time,
how should it consume shift capacity, and what assumptions about resuming setup need clarification?

All dates should use UTC. Discuss safe parsing, date arithmetic with a library such as Luxon,
weekday conventions, midnight, fractional durations, and rounding. I'd like explicit rules for
starts or completions exactly at shift and maintenance boundaries, overlapping maintenance windows,
and calendars with no usable working time.

Compare ways to track occupied work-center intervals: simple scans, sorted reservations, and
interval indexes. How would I detect overlaps and find the earliest feasible slot after all parents
finish? Explain when to recalculate the complete working span after moving a candidate past a
conflict, and how to guarantee progress and termination.

Should an order reserve its entire elapsed span through pauses, or only the segments where it
works? Explain the utilization and correctness trade-offs rather than assuming either policy.
Include deterministic placement and tie-breaking when several orders compete, and show how
calendar maintenance differs from an immovable maintenance order reserving the resource.
