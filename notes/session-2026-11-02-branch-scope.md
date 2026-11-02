# Session 2026-11-02: a block's binds are its own

`r = 5; if c { r = 2; return r }; return r` replied `[5]` from the branch on every target. A branch's
reads now see its binds, the enclosing name is back when the block ends, and an untyped bind on an
outer name is a compile error. That last part settles the rule from `ssa-immutability-2026-04-09.md`.

## The rule

- **`r = 2` on an outer name, in a block, is a compile error.** It looked like a change to `r`, and
  `if c { r = 2 }; return r` would silently reply `[5]`. This covers `if`, `else`, nested branches,
  `repeat while`, `catch`, branches of a function assigned to a name, untyped destructuring, and every
  outer name, including params and values from calls. Before, only some of these were checked
  (`checkBlockBinds` in `validate.js`).
- **`r Integer = 2` shadows on purpose.** Reads in the block see it, and the outer value is back after.
- **A name of the block's own** can be rebound there, `s = 3; s = s + 1`. A name first bound after the
  block doesn't count as outer, and neither does an inline lambda's scope.
- **The right side of a bind** reads the old value, so `r Integer = r + 1` works. On Erlang a bind's
  value used to resolve to its own new name.
- **Types are scoped too.** `r = 5; if c { r Text = "x"; return r }` tags the branch's reply `Text` and
  the other path's `Integer`. An untyped bind from a call has no tag on that path (`bindLocalType`).
- **A loop body is a block** like a branch: `r Integer = 5; repeat while c { r Integer = 2; return r }`
  replies `[2]`.

## What follows an early return

`if c { return r }; r = 6; return r` replied `[6]` from the branch on Rust and Erlang, which run a
non-leading guard after all of a body's locals. Calls and writes after it also ran on the path that
returned. `lowerBranchOrder` (`src/branch_order.js`) now moves what follows a guard into its `else`,
after every check has read the code as written.

## Code

- **JS:** `inBlockScope` and `genBlockBind` in `statements.js`, for branches and loop bodies. Reads
  already resolved through `ctx.ssaScope`, but branch binds didn't update it.
- **Rust:** `inRustBranchScope` and `genRustBranchBind` in `expressions.js`, used by all four branch
  walks and `genRustWhileBody`. A bind from a call goes through `genRustLocals` in every walk now, so it waits for its reply.
- **Erlang:** `branchSSAEnv` in `types.js` gives each branch and loop body uniquely named binds. `buildErlCaseChain`
  threads a scope (`stmtIdx`, `ssaEnv`, `typeEnv`) through the branches, and `makeRet` takes it. A
  bind's value reads with its own assignment filtered out.

## Fixed on the way

- **JS reply tags per path:** a return in a branch carries `pathTag`. This closes the known gap where
  `if c { return "x" }; return 9` tagged `"x"` as `Integer`.
- **Erlang:** `return :r` in a branch replied `[]` from a handler. It now replies `{ r: … }`, tagged.
- **Rust:** `return f(c)` didn't compile when the local function `f` contains a branch, in a handler or
  a private function (`precomputeGuardedFnCall`). A typed `Object` bind of such a call now inlines it.
- **Rust:** a bind inside a branch of an inlined call was dropped by `buildRustGuardChainExpr`.
- **JS:** `return r` in a branch of a private function or class method threw a compile error, because
  `genFnMethod` didn't set `currentTypeEnv`.

- **A `!` function with no params that uses a cell** was renamed as a reactive closure, so calling it
  failed at runtime (`assignClosureAddresses`).
- **Rust:** a private function returning a cell by name didn't build.

## Open

- **Guards the lowering leaves alone, on Rust and Erlang,** still run after the locals, so a call after
  them also runs on the path that returns:
  - a branch that may fall through, `if c { if d { return 0 }; y = 1 }; bump!()`
  - a body whose later statements construct an actor, bind a function or destructure, since branches
    don't run those
  - statements after the guard with no final `return`
- **Rust:** `x = f(); x + 10` doesn't build (`cannot add &BigInt to &Value`), with or without a branch.
