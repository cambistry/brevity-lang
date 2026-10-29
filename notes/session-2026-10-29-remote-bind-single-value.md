# Remote binds take the reply's single value — 2026-10-29

IMPLEMENTED. `x T = r.m()` binds the reply's single unnamed value on every
target; the local's name never selects a named field of the reply. Mirror of
the positional→named fallback removed in c6fe13e
(`session-2026-10-28-destructure-positional-fallback.md`).

Tests: new `__tests__/destructure/remote_call_binds.test.js` (14 cases). Green
on js / rust / erlang except the two lambda-tail cases (see Known failures).
js also run across destructure, classes, services, self, types, operators,
functions: only `self/peer_list` fails (see Known failures).

## Sites fixed

rust (`src/codegen/rust/statements.js`) — all read `_re.get(<local name>)`:
- dep-member bare read (`n Integer = count`, `(:count)` destructured member)
- `handleTypedAssign_DotCallExpr` — remote typed bind
- `handleTypedAssign_RefFieldCall` — reference-field callback typed bind
- `genRustAssignRemoteDotCall` — untyped / handler-local bind

Bugs the wrong read had hidden (rust):
- typed remote bind never set `needsAwaitNew` → no `await_response` emitted,
  build failed. Same for the reference-field typed bind.
- typed remote bind sent `op: "get"` (no `@`) and dropped call args. Typed,
  untyped and destructure remote calls now share
  `genRustRemoteDotCallAwait` (extracted from the destructure path).
- typed bind on a handler-local actor fell to the generic branch:
  fire-and-forget, bound `Null`.

erlang (`src/codegen/erlang/statements.js`):
- dep-member bare read and remote/local typed bind → `bv_object_one`.
- typed bind from a reference-field callback bound the packed `{Pos, Named}`
  tuple; now awaited and unwrapped.

js (`src/codegen/javascript/statements.js`, `classes.js`):
- `x = r.m()`, `v = member(...)`, `v = c.val` binds preferred
  `named[<local name>]` over `BvObject.one`; now `BvObject.one` only.
- dep-member bare read used `[0]` (silently `undefined` on a named reply).
- untyped `x = r.m()` emitted `BvObject` without the preamble
  (`bodyUsesObject` didn't count `DotCallExpr` assigns).
- function/lambda bodies didn't await+pack a `DotCallExpr` destructure source.
- tail-position child send: removed the `named[<method name>]` fallback.

## Known failures (left visible)

1. **`self/peer_list` on js.** `over(peers) (p) { p.name() }` relied on the
   tail fallback: auto-accessors reply named (`@name` → `{ name: v }`). rust
   and erlang still carry the same fallback in their `over` special case
   (`rust/expressions.js` ~1038, `erlang/expressions.js` ~1457), so they pass.
   Resolution decided: **auto-accessors reply positionally** (next session).
   Then `val Integer = t.val()` is the form, `:val Integer = t.val()` is an
   error, and the tail fallback goes on all targets.
2. **Lambda-tail tests on rust / erlang.** Same fallback (erlang); rust also
   can't compile a list literal of child actors (`[C(), C()]` →
   `cannot find value C`). Separate rust bug, open.

## Also noticed, not fixed

- js: in a lambda inside a class, a local named like a class param
  (`:name Text = p.name(); name`) resolves to the param, not the local.
- rust lambdas can't destructure (`name: n Text = p.name(); n` →
  `cannot find value n`).
- destructuring a name the reply lacks binds `null` silently on rust/erlang.
