# Algorithm Research & Scheduling Strategy

I'm building a TypeScript backend service to reschedule manufacturing work orders after delays
or machine downtime. Orders share work centers, can depend on multiple parents, and must receive
their full working duration. Work pauses outside shifts and during maintenance windows, while
maintenance work orders cannot move. I need updated dates, a list of changes, and explanations.

Before I implement this, help me compare established approaches: Greedy Forward List Scheduling,
topological sorting, Critical Path Method, constraint programming, backtracking, and job shop
scheduling. Which are complete scheduling approaches, and which would only solve part of the
problem? Explain their advantages, limitations, computational complexity, and implementation cost
for these constraints.

I'd also like to compare earliest-start, deadline-based, shortest-job, and critical-path priorities.
Manufacturing orders include due dates, but I need to establish whether those are hard deadlines,
soft targets, or context. How would each interpretation affect the algorithm and its objectives?

My first goal is a valid schedule; reducing delay or the number of affected orders could come
later. Compare determinism, predictable runtime, maintainability, and optimality guarantees. Show
a small example where a locally reasonable choice creates a worse schedule or blocks a feasible
one. Please recommend an approach suitable for the assignment's six-hour timebox, explain the
trade-offs, and describe what requirements would justify a more sophisticated solution. Don't
assume greedy scheduling is the right answer before making that comparison.
