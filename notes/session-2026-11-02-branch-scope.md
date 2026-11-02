# Session 2026-11-02: a block's binds are its own

`r = 5; if c { r = 2; return r }; return r` replied `[5]` from the branch on every target. A branch's
reads now see its binds, and a block can't bind a name from its enclosing scope at all. That settles
the rule from `ssa-immutability-2026-04-09.md`.

## The rule

- **Inside a block, a name from the enclosing scope always means that name.** Binding it is a compile
  error, typed or untyped, including destructuring and cell declarations. This covers `if`, `else`,
  nested branches, `repeat while`, `catch` and function bodies, inline or assigned
  (`checkBlockBinds` in `validate.js`).
- **A body's names are all it binds at its own level, wherever in the body.** So `if c { s = 1 }; s = 2`
  is an error, and so is a local function's `x` when the enclosing body binds `x` after it. Statement
  order never changes what's legal.
- **A file's or class's names enclose its handlers and private functions**: `k = 5; @h = { k = 2 }` is
  an error.
- **Still legal:** rebinding in the same scope (`x = 1; x = x + 1`), the same name in separate branches,
  and a key that matches an outer name, which is how a local function keeps a reply field:

  ```
  fn = (a) {
    y = a + 1
    return x: y
  }
  :x = fn(5)
  ```

- **Function params are the one exception.** A param may reuse an outer name in any function notation,
  for that function's body only, and its most useful form is `(name:)` without an alias. Inside the
  function it follows the normal rules: the body can rebind it at its own level, and a block in the
  body can't bind it.
- **A block's own name** can be rebound there, `s = 3; s = s + 1`.
- **The right side of a bind** reads the old value, so `r = r + 1` works. On Erlang a bind's value used
  to resolve to its own new name.
- **Types are per name and path.** `r = 5; if c { s Text = "x"; return s }` tags the branch's reply
  `Text` and the other path's `Integer`. An untyped bind from a call has no tag on that path
  (`bindLocalType`).

## Params that reuse a file or class name

Every target looks up file and class names before locals, so `k = 5; @t = (k Integer) { return k }`
replied `5`, on all three. `lowerParamScope` (`src/param_scope.js`) now gives such a param a name of its
own and keeps its wire key. Setting one (`k <- 1`) is the usual `Cannot set` error unless the param is a
ref. Before, it compiled against the cell in a handler with no `!`.

## A function bound in a branch

`if c { f = (a Integer) { return a + 1 }; return f(10) }` failed on all three targets. Each now lifts it
to a handler like any other local function, capturing through the branch's scope.

- **JS:** a handler with a guard generates its body twice, and the arm came from the first pass while
  the code called the second's name. A function now keeps its handler across passes
  (`genLiftedLambdaBind`). A function outside a branch was on the same path.
- **Rust:** `genRustBranchBind` lifts it (`genRustLiftedLambda`), and a typed bind of its call goes
  through `genRustLocals`. A lifted function with an explicit `return` also replied nothing, in or out
  of a branch.
- **Erlang:** a return field held the whole reply from `self_send`, which is now unwrapped
  (`genReturnValue`).

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
- **JS only:** `f = (a) { return a + 1 }` wants a type on the return, and Rust and Erlang compile it.
