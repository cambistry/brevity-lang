# Session 2026-11-02: a branch's binds are its own

`r = 5; if c { r = 2; return r }; return r` replied `[5]` from the branch on every target. Only Rust's
instance-call path got it right. A bind in a branch now takes a name of its own, reads later in that
branch see it, and the enclosing name is back when the branch ends.

## The rule

- **Inside the branch:** reads see the latest bind, including in nested branches.
- **The right side of a bind** reads the old value, so `r = r + 1` works. On Erlang a bind's value
  used to resolve to its own new name. That lookup is shared with enclosing bodies, and a test now
  covers `r = r + 1` there too.
- **After the branch:** the outer value is unchanged. `if c { r = 2 }; return r` replies `[5]`, as the
  existing shadow test in `if.test.js` requires.
- **Types are scoped too.** `r = 5; if c { r = "x"; return r }` tags the branch's reply `Text` and the
  other path's `Integer`. A value that can't be inferred, like `r = b.one()`, has no tag on that path
  (`bindLocalType` in `src/inference.js`).

## Code

- **JS:** `inBlockScope` and `genBlockBind` in `statements.js`. Reads already resolved through
  `ctx.ssaScope`, but branch binds didn't update it.
- **Rust:** `inRustBranchScope` and `genRustBranchBind` in `expressions.js`, used by all four branch
  walks. A bind from a call goes through `genRustLocals` in every walk now, so it waits for its reply.
- **Erlang:** `branchSSAEnv` in `types.js` gives each branch uniquely named binds. `buildErlCaseChain`
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

## Open

- **The re-bind rule is uneven.** `checkRebind` rejects an untyped `x = …` on an outer name inside
  `y = if { … }` and `repeat while`, but not inside a statement `if`, which is what makes this form
  legal. Nothing changed here: the ticket wants statement `if` to work, and `if.test.js` still requires
  the error for `y = if`.
- **Typed shadow directly in a loop body:** `r Integer = 5; repeat while c { r Integer = 2; return r }`
  replies `[5]` on all three targets. A branch inside a loop is fixed; the loop body itself isn't.
- **A rebind after a branch, on Rust and Erlang:** `r = 5; if c { return r }; r = 6; return r` replies
  `[6]` from the branch. JS replies `[5]`. Those targets run a non-leading branch after all the body's
  locals, which also means the locals' effects happen before the branch.
