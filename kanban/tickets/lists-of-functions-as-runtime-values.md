---
created: 2026-11-26
---
# A List of functions as a runtime value

Design: `notes/clause-lists-2026-11-25.md` ("The idea"). Split from `clause-lists-callable-lists-with-pattern-heads`, which compiles a clause-list literal to an anonymous overloaded function.

Want: a List whose element type is a function type is callable at runtime, walking its entries from the head; the first that accepts the arguments answers.

- `[&fn1, &fn2](args)`; a clause list held in a cell or passed as a value.
- `xs[i]` reads an entry (from 0); `fs(args)` applies the clauses; calling never indexes.
- `[ … ] + more` appends clauses; `List.sort` on a clause list changes which clause wins.
- `List[T](args)` compiles only when `T` is a function type (a union of clause profiles counts); `["a", "b"](1)` and an untyped `List[Anything]` are compile errors until cast (`as List[(Text) -> View]`).
