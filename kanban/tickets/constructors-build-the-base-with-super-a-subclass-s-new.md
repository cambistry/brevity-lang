---
status: done
created: 2026-11-20
---
# Constructors build the base with `super`; a subclass's `new` takes its own params only

Design: notes/super-2026-11-19.md ("In a constructor, `super` builds the base").

- Stop merging params: a subclass's `new` takes the params its own constructor piece declares, nothing inherited (retire inheritedParams in resolveSuperclassChain and its callers in each codegen).
- `super(args)` in a constructor block runs the parent's constructor on the merged base with `args`. Bare `super` passes the constructor's args exactly as received, positional and named. `super()` passes none.
- The parent's constructor body runs at the `super` line, no longer before the subclass's body. A base name read before that line is a compile error.
- Every path: `super` is called exactly once on every path through the constructor. An `if` whose branch calls it needs an `else` that does too. `super` in a loop, or twice on one path, is an error.
- For this ticket a constructor that never calls `super` is an error, unless the class has no parent. The no-base case is the interface-coverage ticket.
- Several parents: `super[A](…)` / `super[B](…)`, each on every path. Bare `super` with more than one parent is an error naming `super[A]` / `super[B]`.
- `super` stays reserved: `super = …`, `super.x`, `super::x` still fail generically.
- Rewrite the tests built on merged params (subclasses.test.js "mixed positional/named args", subclass_consumption.test.js, overload.test.js `Sub = Base ^ (b Integer)`, …) as `super(…)` forwarding tests. Don't drop any.
- Tests on every target: forwarding as is, amended, and bare; `super()` vs `super` with params; parent body runs at the `super` line (order visible in state); read-before-`super` error; missing on a branch; in a loop; twice; bare `super` with two parents.
- Docs: LANGUAGE_OVERVIEW.md, docs/SYNTAX_CRIB.md, docs/LLM_WRITING_BREVITY.md, __tests__/classes/index.md.
- Not in scope: `super` in functions, no-base constructors, class blocks, `class::base`, compositions with no constructor piece (`D = C^`, `A ^ B`; see Open in the note; ask before choosing).
