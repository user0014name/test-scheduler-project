# Dependency Graph & Scheduling Constraints

I want to work through dependency modeling and constraint validation before committing to a
scheduling design. An order can have several parents, all of which must finish before it starts,
and dependencies may cross work centers.

Help me compare representations for these relationships, including adjacency lists and dependency
counts. How would Kahn's algorithm and DFS support traversal, topological ordering, and cycle
detection? Explain their complexity, diagnostic quality, and suitability for large dependency
chains. I'd like a clear policy for missing parents, duplicate IDs or edges, self-references, and
circular dependencies, including a cycle that blocks otherwise acyclic descendants.

How should fixed maintenance windows and immovable maintenance orders interact with dependency
timing? Consider a maintenance order that has parents or children, and a parent whose delayed
completion would miss the maintenance order's fixed start. Which conflicts can be rejected before
scheduling, and which require attempting placement?

I also need to distinguish business deadlines from a bounded scheduling horizon. Help me decide
which constraints must be hard, whether due dates should be soft targets, and how to handle
contradictory constraints. Explain the difference between proving infeasibility, exhausting a
search limit, and a heuristic failing even though another ordering could work. What errors and
affected-order details would make those outcomes useful to a caller without overstating what the
algorithm has established?
