---
status: inbox
created: 2026-11-25
---
# Lambda params should take their types from the slot

A lambda's params should be inferred wherever the slot determines them: the element type in `over`, `map`, `filter` and `find`; the seed and element types in `reduce`; the subject in a clause list; the delivered value in `sub`. Then lambdas need no param types (`reduce([], mine) (acc, card) { … }`).

Today, checked on js:

- Untyped params compile, but they aren't typed from the list: with `xs *List of Integers`, `over(xs) (x) { Text.slice(x, 0, 1) }` and `reduce(0, xs) (acc, x) { acc + Text.size(x) }` compile without error, though `x` is an Integer. A misuse is silently accepted.
- The result isn't inferred either: `r = over(xs) (x) { x + 1 }` and `r = reduce(0, xs) (acc, x) { acc + x }` fail with "Variable 'r' requires a type annotation", even with a typed `acc`. (Related: `an-unannotated-bind-infers-only-literals-and-own-calls`.)
- Callback-typed slots on a type's field or a service method already infer their lambda's params (`notes/session-2026-10-27-lambda-param-inference.md`); the collection forms should do the same.
