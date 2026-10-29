# Maintainability & Readability

Before I turn the scheduling design into TypeScript, help me structure it so another backend
engineer can understand and extend it. I'd like clear module boundaries for input validation,
dependency handling, working calendars, resource allocation, and reporting changes, while keeping
the overall algorithm easy to follow.

How would you express the scheduling flow and its invariants without spreading one decision across
too many layers? Suggest descriptive names and places where a comment should explain a non-obvious
policy, such as how paused work occupies a center or why a particular priority is used. Compare
reusable graph and date utilities with keeping short, purpose-specific logic local; I don't want
a generic scheduling framework unless it earns its complexity.

Please recommend TypeScript practices for document types, optional setup time, validated dates,
immutable inputs, and explicit scheduling outcomes. How should domain errors consistently expose
the failed constraint and relevant work orders while unexpected programming errors remain visible?
Explain where runtime validation is needed even with static types.

I'd also like a plan for reviewing and refining the implementation once it exists: check readable
control flow, hidden assumptions, unnecessary abstractions, and consistency between documented
behavior and tests. What should the README explain about setup, running sample scenarios, the
algorithm, trade-offs, and known limitations? Help me keep required behavior separate from optional
optimizations, and use focused future-improvement notes for work that falls outside the timebox.
