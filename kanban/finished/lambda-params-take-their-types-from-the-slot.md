---
created: 2026-11-25
---
# Lambda params should take their types from the slot

Want: a lambda's params should be inferred wherever the slot determines them: the element type in `over`, `map`, `filter` and `find`; the seed and element types in `reduce`; the subject in a clause list; the delivered value in `sub`. Then lambdas need no param types (`reduce([], mine) (acc, card) { … }`).

Today (checked on js):

- Untyped params compile, but they aren't typed from the list: with `xs *List of Integers`, `over(xs) (x) { Text.slice(x, 0, 1) }` and `reduce(0, xs) (acc, x) { acc + Text.size(x) }` compile without error, though `x` is an Integer. A misuse is silently accepted.
- The result isn't inferred either: `r = over(xs) (x) { x + 1 }` and `r = reduce(0, xs) (acc, x) { acc + x }` fail with "Variable 'r' requires a type annotation", even with a typed `acc`. (Related: `an-unannotated-bind-infers-only-literals-and-own-calls`.)
- Callback-typed slots on a type's field or a service method already infer their lambda's params (`notes/session-2026-10-27-lambda-param-inference.md`).

**Scope (2026-11-27):** a lambda's body in these slots wasn't checked at all, even with typed
params; now it is, with the slot's types. The misuse examples above (`Text.slice(x, 0, 1)`,
`acc + Text.size(x)`) still compile, because `Text.*` args and arithmetic operands aren't checked
anywhere, lambda or not: `text-function-args-and-operands-are-type-checked`. A bind inside an `if`
used as a value (a clause list's clauses among them) isn't checked either:
`a-bind-in-an-if-value-branch-is-checked`. Result inference (`r = over(xs) …`) is
`an-unannotated-bind-infers-only-literals-and-own-calls`.
