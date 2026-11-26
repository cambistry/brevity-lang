---
created: 2026-11-21
---
# Instance layers: a parent in another file

Design: notes/opre-extend-and-as-2026-11-20.md ("Instance layers", "as", "Grandparents", "Several parents"); notes/super-2026-11-19.md.

- `U = T ^ (…) *{ super(args) … }` where `T` comes from `use`: `super(args)` sends `{ op: [[args], '$new'], to: <T>, from: ':', as: ':' }`. The parent class builds a layer for that instance, accepting only a sender under a recorded extender. Its reply is the layer's address, which no one else is given.
- The layer runs the parent's constructor body at the `super` line. The child's next line waits for it.
- Between the instance and its layer:
- a name the instance doesn't define, `super`, and `base::` / `base.` are delegated calls with `as`
- the layer's late-bound names resolve through the `instance` table, back to the instance
- `~` cells: `$get` / `$set` either way
- `super[A]` / `super[B]` build one layer each. A diamond of instance layers is a compile error.
- No `super`: no layer, no `$new`, and the no-base rules of super-2026-11-19.md (using the missing base is a compile error).
- Local parents stay merged: the semantics are layers, and the merge is an optimization (ticket 8 holds it to that).
- Tests on every target, the parent a separate actor: forwarding args, as is, amended and bare; a protected cell read and written through the instance; an override and a redeclared cell seen by the parent's code; `super` and `base::` in functions; a published param of the parent's answered through the instance; two levels; two parents; the diamond error.
- Not in scope: lifetime (layers leak until CAM has a notion of an actor's end), security.
