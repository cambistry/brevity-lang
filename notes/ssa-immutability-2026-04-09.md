# SSA / const-only bindings — JS + Rust

**Goal:** bring the JS and Rust transpile into line with Erlang. Non-ref locals
are immutable. Source-level rebinding (`x = 1; x = 2; x = 3`) becomes SSA
suffixing under the hood (`x__1`, `x__2`, `x__3`). Every emitted binding is
`const` (JS) or `let` without `mut` (Rust) except for compiler-generated
temporaries. No user-facing syntax change.

## Naming scheme: uniform 1-indexed `__N` suffixing

Every SSA-emitted name is `${source_name}__${n}` where `n` starts at 1.
There is no "bare first binding, suffixed rebindings" special case.

**Why 1-indexed:** the primary consumer of these names is a human reading
emitted code during debugging. "`x__2` is the second `x`" matches ordinal
intuition; "`x__2` is the third `x`" would require mental off-by-one on
every read. Since the whole point of uniform suffixing is debuggability
and honesty, optimizing for the reader wins. Internally this is a single
`+1` on the counter.

**Collision-proof by construction.** If a user writes an identifier that
happens to look like an SSA name (e.g. `x__1`), the compiler treats the
whole thing as the source name and appends its own suffix, yielding
`x__1__1`. Four bindings demonstrate:

```
x = 1         → x__1
x = 2         → x__2
x__1 = 3      → x__1__1   (source name "x__1", first binding)
x__1 = 4      → x__1__2   (rebinding of "x__1")
```

All four emitted names are distinct; no user identifier can ever collide
with a compiler-generated one.

**Reverse-mapping emitted names to source names** is trivial: strip the
trailing `__\d+`. This is useful for error messages and debugging.

**Cost:** emitted code is slightly noisier. A variable that is never
rebound emits as `x__0` instead of `x`. Uniform, regular, readers adapt.
The cost is small and bounded, and it buys collision-proofness plus
uniformity of the emitter (no special case for "first binding").

### Erlang backend bugfix (in scope for this ticket)

The Erlang SSA at `src/codegen/erlang/types.js:70` currently uses:

```js
const ssaName = n === 0 ? s.name : `${s.name}__${n}`;
```

This has a latent collision bug: if a user writes `x__1` as a source-level
identifier and also rebinds `x`, both map to `X__1` in emitted Erlang and
the second binding fails Erlang's pattern match at runtime. No test
currently triggers this, but it's a landmine.

Change to (1-indexed):

```js
const ssaName = `${s.name}__${n + 1}`;
```

One line. Side effect: all Erlang emitted code for locals gains a `__N`
suffix starting at `__1` for the first binding. Re-run the Erlang test
suite and regenerate any goldens.

**Follow-up (not in this ticket):** refs via self-send, see
`refs-via-self-send-2026-04-09.md`.

## Why this is option (a), not (b)

Option (a) = SSA suffixing. Option (b) = compile error on rebinding.

We chose (a) because it's *technically* immutability with sugar: the source
still reads like rebinding and the `@rebind` test
(`__tests__/values/locals.test.js:35-69`) continues to pass unchanged. The lie
being corrected is in the *emission*, not the surface syntax. The
`binding-model-2026-03-24.md` note stays valid: "a plain local is rebindable in
its declaring scope" — it is, source-level.

## Reference implementation

Erlang already does this. Study these sites:

- `src/codegen/erlang/types.js:59-88` — `buildSSAEnv(body)`. Single forward
  pass, counts assignments per name, mints `name`, `name__1`, `name__2`.
  Handles `TypedAssign`, `Assign`, `DestructureAssign`, `ListDestructure`.
  **Explicitly skips** overload forms: `Function()` empty init, `<<` append,
  `>>` prepend — these mutate a handler chain, not a binding.
- `src/codegen/erlang/types.js:90-104` — `resolveSSAName(name, stmtIdx, env)`
  and `getSSANameForAssignment(name, stmtIdx, env)`. Positional walk through
  the assignments list.
- `src/codegen/erlang/statements.js:26` — SSA env creation per function body.
- `src/codegen/erlang/statements.js:72` — emission site uses
  `getSSANameForAssignment`.
- `src/codegen/erlang/expressions.js:38-39, 934` — identifier references use
  `resolveSSAName` with `sCtx.stmtIdx`.

The core insight: SSA state is per-body and is threaded through the statement
walk via `stmtCtx = { ...sCtx, stmtIdx: i, ssaEnv }`.

## Phase 1 — JavaScript backend

### Design choice: scope map, not stmtIdx

The Erlang backend uses `(stmtIdx, ssaEnv)` to resolve identifier references.
This requires threading `stmtIdx` through every `genExpr` call.

JS has a cleaner option: maintain a **scope map** (`Map<string, string>`)
that's updated inline as the body walker advances. Each statement:
1. Evaluate RHS first using the current scope map → correct pre-assignment
   resolution.
2. Mint a new SSA name for the LHS if this name is already in the map.
3. Insert the new mapping.

`genExpr` reads from the scope map (available via `ctx`). No `stmtIdx`
plumbing.

Why not match Erlang's approach exactly? The scope-map approach is simpler for
JS because:
- JS codegen walks the body linearly with `for (const s of body)` — no index
  is used today.
- Threading a stmtIdx through hundreds of `genExpr` callsites is a large
  mechanical change with many edit sites.
- Scope-map is closer to how real compilers do SSA anyway.
- It composes naturally with nested scopes (push/pop a scope layer) and
  lambda capture (snapshot the scope map at lambda creation).

If scope-map composition turns out to be harder than expected for nested
constructs (`if` branches that both rebind the same name, `while` loops),
fall back to porting Erlang's `stmtIdx` approach verbatim.

### Files touched

- `src/codegen/javascript/statements.js`
  - Replace `makeBindingContext()` (lines 9-40). The new version maintains a
    scope map and returns `{ emitBinding, resolveIdent, pushScope, popScope,
    snapshot }`.
  - `emitBinding(name, rhs)` always emits `const`. If `name` is already in
    the scope map, mint `${name}__${n}` where `n` is the next unused suffix.
    Update the scope map to point `name → name__n`.
  - Audit every call site of `emitBinding` in the file (~10 sites for
    `Assign`, `TypedAssign`, destructure temps, if-expr results). Ensure the
    RHS is generated *before* the scope map is updated.
  - `genTypedAssignStmt` and the `Assign` branch need to pass through so that
    the RHS sees pre-assignment state. The existing code already does this
    structurally; just verify.
  - The if-expression temporary (`let ${tmpVar} = null;` at line 324)
    stays `let`. It's a compiler-generated temp, not a user binding. Add a
    comment.
  - Destructure temps (`const ${tmp} = ${genExpr(...)}` at line 135 and
    similar) are already `const`. No change.
- `src/codegen/javascript/expressions.js`
  - `genExpr` for `Identifier` (line 191): if the scope map has an entry for
    the name, use the mapped SSA name. Otherwise fall through to current
    behavior (state var, `ctx.stateVarNames`, etc).
  - `collectFreeVars` (lines 11-85): unchanged. Free var detection is
    name-based and happens at the AST level before SSA resolution.
  - **Lambda capture snapshot:** when lifting a lambda, snapshot the current
    scope map. Free vars in the lambda body that resolve to the outer scope
    must resolve against the snapshot, not the outer scope's current state at
    some later emission point. This matches the semantic that lambdas capture
    the value at creation time.
  - `lambdaUsesOuterRefs` (lines 95-113): no change in this phase. Refs still
    use the `{value: ...}` wrapping; the ref-access overhaul is phase two.
- `src/codegen/javascript/classes.js`
  - No direct emission change, but verify that any inline `emitBinding`-style
    calls go through the new path.

### Nested scopes — the scope rule

The scope rule distinguishes **branches** (continuation of current scope,
conditionally) from **lambdas** (explicit new scope boundary). Branches
forbid shadowing; lambdas allow it.

- **Handler body (top-level of a dispatch):** SSA applies. `=` mints a fresh
  suffix on rebinding. Sugar over immutability.

- **`if` / `else` branch bodies:** each branch has a discardable inner scope
  for branch-local fresh names. **`=` to a name that already exists in any
  enclosing scope is a validator error.** The only ways to affect outer state
  from inside a branch are:
  1. Produce a value via the if-expression form, assigned at the parent level
     (`result = if cond then ... else ...`).
  2. Mutate a ref with `*x <- value`.

  Within a branch body, fresh names (no outer conflict) are fine and may be
  rebound using SSA as normal. Example:
  ```
  result = if cond
    tmp = compute()        // fresh branch-local, fine
    tmp = tmp + 1          // SSA-rebound within branch, fine
    tmp
  else
    fallback
  ```
  But:
  ```
  x = 1
  if cond
    x = 2                  // ERROR: cannot = an outer name from a branch
  ```
  Must instead be written as `x = if cond then 2 else 1` or `*x <- 2` with
  `x` as a ref.

- **Lambda bodies:** lambda bodies have their own scope by closure semantics.
  Parameters shadow trivially. Inside the body, `=` to a name that is a free
  var of the lambda creates a **fresh lambda-local** (shadow). The outer
  value is unaffected; the lambda sees its own shadow from that point on.
  Rationale: the developer explicitly crossed a scope boundary by writing
  the lambda, matching how every closure language works.

  At lambda creation, snapshot the parent scope map so free vars resolve to
  the outer scope's SSA names **at the point of lambda creation**. Inside the
  lambda, SSA proceeds normally from that snapshot, with shadows taking
  precedence over the snapshot for any name the lambda assigns.

- **`while` loops:** loop bodies that rebind locals are currently legal in
  emission but incoherent under SSA (would need phi nodes). **Validator
  error:** rebinding a non-ref local inside a loop body. Loop-carried
  mutable state must use a ref (`*x <- x + 1`). Audit the test corpus before
  enforcing; any test rebinding a loop-local is wrong and should be rewritten
  to use a ref.

### Overload forms

Per Erlang's precedent (`erlang/types.js:68`,
`erlang/statements.js:39-69`), skip SSA counting for:
- `s.value.type === 'Function' && s.value.overloadMode === 'append'`
- `s.value.type === 'Function' && s.value.overloadMode === 'prepend'`
- `s.value.type === 'Function' && s.value.emptyOverload === true`

These register additional dispatch arms on an existing lambda label; they do
not create a new binding. The name stays mapped to the original SSA slot.

### Pattern matching concerns

Brevity has Elixir-style handler pattern matching, but individual handler
bodies are the bodies being SSA'd — the match happens at dispatch, not inside
the body. SSA is per-handler-body and doesn't interact with match semantics.
Verify this by checking that `genHandlers` wraps each handler body in its own
`makeBindingContext`.

## Phase 2 — Rust backend

Rust has no SSA today. Every binding emits plain `let`. The `mutableVars`
parameter is threaded through but never consulted (`rust/statements.js:20,
1200`). Dead.

### Files touched

- `src/codegen/rust/statements.js`
  - Introduce a scope-map equivalent to the JS version. Rust's statement
    walker is structurally similar (single forward pass over body).
  - Every `let` emission site for user-level bindings (lines 27, 100,
    140-142, 341, 1341, …) routes through an `emitBinding` helper that
    mints SSA names.
  - Identifier resolution in `rust/expressions.js` consults the scope map.
  - `mutableVars` parameter: delete. It's unused and will confuse readers
    post-refactor.
- `src/codegen/rust/expressions.js`
  - `genRustExpr` for identifiers: look up the scope map.

### Rust-specific gotchas

- **Type annotations on rebound names:** Rust requires the type to be
  consistent across rebindings if they end up in the same scope, but with SSA
  suffixing each rebinding is a genuinely new binding with its own type
  annotation, so this is fine.
- **Shadowing vs. SSA suffixing:** Rust already allows shadowing (`let x = 1;
  let x = 2;`) with plain `let`. We could emit shadowing instead of SSA
  suffixes — the compiled behavior is identical. **Reject this.** Consistency
  with Erlang and debuggability (a stack trace showing `x__2` is clearer than
  ambiguous `x`) win. Emit suffixed names.
- **Closures:** Rust closures capture by reference / move semantics depending
  on usage. Post-SSA, the captured name is always an immutable const, so
  `move` closures are safe and preferred. Audit the closure emission path
  when we get there.

## Testing

### Existing coverage

- `__tests__/values/locals.test.js:35-69` — the `@rebind` handler. **Must
  still pass unchanged.** This is the primary smoke test: source-level
  rebinding works, emission is SSA.
- `__tests__/keywords/ref.test.js:264-272` — refs cannot be rebound with `=`.
  **Must still throw.** SSA does not apply to refs; the error path is
  independent.

### New coverage to add

- Rebinding with the RHS referencing the prior binding: `x = 1; x = x + 1`
  should emit `const x = 1; const x__1 = x + 1;` and return `2`. Test against
  all three backends (Erlang already passes; adding parallel JS/Rust tests).
- Rebinding across a lambda boundary: a lambda that closes over `x` before a
  rebinding should see the pre-rebind value at execution time.
- Rebinding inside an `if` branch: only the chosen branch's mutations should
  be observable after the if, via the if-expr temp.
- Rebinding with destructuring: `(a, b) = pair(); (a, b) = other_pair()`.
- Rebinding across overload forms: declaring a lambda then appending to it
  should not SSA-rename the lambda label.

### Golden regeneration

Any JS or Rust golden fixture files may need regeneration if they currently
show `let` for rebound names. Expect churn here. Audit goldens before
starting emission changes.

## Risk and rollback

- The SSA change is localized (two files in JS, two in Rust). If the scope-map
  approach causes unexpected trouble with nested scopes, fall back to the
  Erlang-style `stmtIdx` threading approach.
- The JS backend emits user-facing code that runs in the Brevity runtime and
  the browser target. Any regression is immediately visible in test output.
- Rollback is a single-commit revert — the change does not alter the AST,
  parser, or any persistent format.

## Ordering

1. **JS first.** Smaller callsite surface, richer test coverage, faster
   iteration loop.
2. **Regenerate JS goldens, verify `@rebind` test passes, add new test cases.**
3. **Rust second.** Port the scope-map helper. Delete `mutableVars`.
   Regenerate Rust goldens.
4. **Verify Erlang is unchanged.** No Erlang edits in this ticket — it's the
   reference. But re-run the Erlang test suite to confirm no incidental
   breakage from shared AST walks or validator changes.
5. **Document in changelog.** SSA is an emission-level change; no user-facing
   impact, but worth a note for anyone reading emitted JS/Rust code.

## Out of scope

- Refs via self-send. See `refs-via-self-send-2026-04-09.md`.
- Deleting `lambdaUsesOuterRefs`. That simplification unlocks only after refs
  stop being captured.
- Capture pruning (only-serialize-refs). That follows from refs-via-self-send.
- Changing `binding-model-2026-03-24.md`. Under option (a), rebinding is still
  a supported source-level concept. The note remains accurate.
