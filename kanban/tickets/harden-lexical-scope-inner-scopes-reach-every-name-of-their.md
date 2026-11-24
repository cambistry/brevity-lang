---
status: done
created: 2026-11-17
---
# Harden lexical scope: inner scopes reach every name of their containing scopes

Rule (2026-11-16): an inner scope captures, and interacts directly with, the public (`@x`), protected (bare `x`) and private (`#x`) names of every scope lexically containing it. Interaction means read, write (`*` cells only), call and subscribe. Reads see the value at the time (a constructor-block read is taken once, at construction). No exceptions by visibility or by kind of inner scope. See notes/private-names-lexical-2026-11-16.md.

Matrix to cover, as wire tests

- Name kinds: cell (`*`), constant, function (plain and with params), writing function (`f!`).
- Visibility: `@x`, `x`, `#x`.
- Containing scope: file actor, class, class block (`**{ … }`), function body.
- Inner scope:
- closure / lambda, including no-param lambdas and lambdas inside lambdas
- function-local function (`#g = …` / `g = …` inside a body)
- class declared inside, at depth 1 and depth 2
- a class block's nested `new`: its constructor block, its methods, its closures
- any class's constructor block and its param defaults
- branch and loop bodies, and `over` / `reduce` functions
- subscribe callbacks and `on` handlers
- Operation: read, write, call, subscribe.

Boundaries (assert these too; they're not exceptions)

- Not lexically inside, so no bare access: a trailing or `++`-composed constructor and its class block (qualified `class.` / `class::` only); a subclass and its parent's private names. The error says which.
- A private name is never reached through an address (`x.#y`, `class::#y`).
- Shadowing: the innermost declaration wins where the existing rules allow shadowing (a class's own name wins; function params may reuse an outer name). Cover both, and the no-shadowing errors.
- Writes: only a `*` cell can be set. A constructor block that writes an enclosing actor makes the class bang-named (`C!`).

Known failures found 2026-11-16 (fix under this ticket)

- js: a lambda in a file handler calling the file's `#f` replies with the wrapped object (`[{"positional":[3],…}]`) instead of `[3]`.
- A lambda calling a function-local `#g` fails to parse ("Unexpected identifier '#g'").
- Reading a function-local `#t Integer = 3` fails at runtime; a lambda naming it fails to parse.
- Private constants and cells don't parse outside function bodies (tracked in the private-values ticket; its cases belong in this matrix once it lands).
- Rust and erlang results for the private-function cases aren't confirmed yet.

Fixed in the working tree, uncommitted (keep and extend their tests)

- js and erlang: lambdas captured enclosing-actor names as free variables (`collectFreeVars` / `erlCollectFreeVars` now skip outer reads and outer calls).
- erlang: any lambda called inside a class method failed (its dispatch arm was emitted only in the file actor's dispatch).
- erlang: a lambda reading an enclosing actor's cell was compiled as an inline fun reading a local ref.
- rust: an enclosing actor's function call inside arithmetic wasn't converted to a number.

Tests

- Extend __tests__/classes/class_scope.test.js, __tests__/classes/outer_reads.test.js, __tests__/classes/outer_writes.test.js and __tests__/functions/private.test.js, or add __tests__/classes/lexical_scope.test.js. One shared script per describe, literal expectBehavior steps.
- Run on js, rust and erlang. Never skip a target, and never drop a case because it fails.

Done when every cell of the matrix and every boundary has a test, and all pass on js, rust and erlang.
