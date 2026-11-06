# Session 2026-11-06: an unannotated bind takes its callee's return type

`x = @seed()`, where `@seed = { return 9 }`, bound `x` as Anything, in a handler and in
a constructor block, so a reply carrying `x` went out with no tag or `ty: 'Anything'`.
`x Integer = @seed()` already worked. Not committed.

## Rule

An unannotated bind of a call (`x = f()` in a function body, `e = f()` in a
constructor block) is treated as `x T = f()` when the callee has one return type:

- every return path is a single positional value (no names, no `self`, no spread);
- the paths merge to one type that isn't `Anything`, a union, `Object`, `null`, a
  function type or an actor (local class, manifest class or dependency).

Callees: own functions (`@seed()`, `seed()`, every clause the args could select),
class methods (`c.get()`, including inherited ones; an auto-accessor has no return
shape here, so it isn't inferred), and doc entries (`Svc.count()`, `t.get()` on a
dependency instance). This is the same resolution that checks an annotation
(`callReturns`), so an inferred bind and an annotated one can't disagree.

## Implementation (`src/validate.js`)

- `inferCallBinds(ast, …)` runs before `validateActor`, once per actor per round:
  - constructor block: a `TypedAssign` with no `typeName`/`rhsType` and a call value,
    whose `stateVarDecls` entry the parser settled to `Anything`. Both get the type.
    An explicit `e Anything = f()` has a `typeName`, so it stays.
  - function bodies: top-level `Assign` of a call becomes a `TypedAssign`.
  - Rounds repeat until none changes: a bind's type can make another callee's return
    known (`@later` calling `@local`, declared after it, which returns its own
    inferred `x`). Each round binds at least one more name, so it ends.
- It calls `validateBody` with a new last param `inferOnly`, which builds the call
  resolution and returns the count it typed, skipping the checks.
- `actorDeps` and `actorStateTypes` are pulled out of `validateActor` so the pass and
  `validateActor` share them.

Because it rewrites the AST into the annotated form, the backends needed nothing;
js, erlang and rust all tag the reply, except for one rust bug it exposed:

- **rust, a typed bind after a returning branch:** `genRustBranchBind` emitted
  `let x: BigInt = <Value>.one()` for `x Integer = bump!()` (a call to the actor's
  own function), which doesn't compile. It already did for the annotated form at
  HEAD; nothing exercised it. It now converts the Value, as the branch-body path
  does. `keywords/if.test.js` "a bind after a branch" (`x = bump!()`) covers it.

## Limits

- Top-level binds of a body only, like the annotation checks. A bind inside an
  `if`/`while` block is still untyped.
- A bare call to a name that several actors define (e.g. `@get()` in a class while
  another class has `@get`) doesn't resolve (`callReturns` wants one owner), so it
  stays untyped.

## Tests

- `functions/return_shapes.test.js` — "an unannotated bind of a call": a handler, a
  bind whose callee's type came from inference, the file's constructor block, a
  class method and a class's constructor block, a doc entry.
- `classes/constructor_block.test.js` — `e = @seed()` and `v = c.get()` dropped
  their annotations.
- `types/type_coercion.test.js` — "an untyped bind takes a sole positional" now
  expects `ty: { r: 'Integer' }`; it asserted the missing tag.
