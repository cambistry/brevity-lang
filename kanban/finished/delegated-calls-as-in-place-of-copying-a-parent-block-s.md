---
created: 2026-11-21
---
# Delegated calls: `as`, in place of copying a parent block's functions

Design: notes/opre-extend-and-as-2026-11-20.md ("as: a delegated call", "Grandparents", "In Brevity").

- Retire the copying of the parent block's functions (flattenDelegatedBlocks).
- A call to a child block for a name it doesn't define goes to the parent block with `as: ':'`. So do `super` and `base::h()` / `base.f()` in the child block's functions (`base::` is `super` named explicitly).
- The parent runs its own definition of the entry op for that context. Each public or protected name it reaches, the entry op included, resolves through the context's table: an override is a call back to `from` with the same `as`, a redeclared cell a `$get` / `$set` of `~name` there, anything else the parent's own. A middle block resolves a callback for the context, or forwards it to its extender.
- `as` equals `from`, or a context `from` registered; otherwise the call fails.
- An explicit `A.f()` from the child block sends no `as`, and runs as the parent.
- Reentrancy: the parent keeps answering while it waits on the child, under the turn rule in force.
- Tests on every target: an inherited function run for the child sees its override and its redeclared cell; `super` and `base::`; `A.f()` from the child runs as the parent; two and three levels, an override at each; the "two levels" tests in super.test.js stay green; an `as` naming an unregistered context fails.
- Docs: LANGUAGE_OVERVIEW.md and __tests__/classes/index.md, where they describe class block inheritance.
- Not in scope: instance layers; several parent blocks (still an error).
