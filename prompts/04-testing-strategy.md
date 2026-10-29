# Correctness & Testing

I want to plan tests that demonstrate the scheduler respects its constraints, rather than just
checking a few expected schedules. Help me divide testing between dependency logic, calendar
calculations, resource allocation, and the complete scheduling workflow.

Which small examples would expose mistakes in multiple-parent dependencies, cycle detection,
scheduling priorities, and exclusive work-center allocation? Include invalid references, duplicate
IDs, empty input, and a cycle with downstream dependents. For calendars, cover exact shift ends,
breaks, overnight and weekend pauses, setup time, and maintenance boundaries. I'd also like cases
for immovable maintenance conflicts, agreed deadline rules, and a search horizon reached before
completion.

How should I test deterministic results and input immutability? Distinguish repeating identical
input from reordering input or feeding a returned schedule back into the service. Consider invalid
dates, zero or fractional durations, missing shifts, and genuinely infeasible constraints, while
allowing a heuristic to report failure without claiming that no valid ordering exists.

Suggest property-based tests and scheduling invariants: parents finish before children start,
resource allocations do not overlap, all required working minutes are delivered, and fixed
maintenance stays fixed. How can I generate useful inputs and shrink failures reproducibly?
Discuss independent hand-calculated cases or a small exhaustive reference model so that validation
doesn't merely repeat the scheduler's mistakes. Prioritize regression cases and the assignment's
delay-cascade and shift-or-maintenance scenarios, including changes and explanations in the output.
