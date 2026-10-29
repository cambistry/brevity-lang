# Auto-accessors reply positionally — 2026-10-29

IMPLEMENTED. Follows `session-2026-10-29-remote-bind-single-value.md`, which
left `self/peer_list` failing on js pending this decision.

Tests (scoped): js — accessors, subclasses, peer_list (84 passed). rust and
erlang — those three plus `destructure/remote_call_binds` (96 / 98 each; the
2 failures are the list-of-child-actors gap below).

## Change

An auto-accessor (the `@name` handler synthesized from a class param) replied
with a named object keyed by the param name: `@val` → `{ val: v }`. It now
replies with the value positionally: `[v]`, the same shape as an explicit
`@val = { val }`.

```
val Integer = t.val()      // binds the value
:val Integer = t.val()     // compile error: t.val() returns no named 'val'
over(ps) (p) { p.name() }  // a list of names, no fallback
```

Why: the `val:` key was never declared anywhere — an artifact of the
generator. The extracted service interface doesn't list accessors, so callers
couldn't learn the shape; replacing an auto-accessor with a hand-written one
silently changed the wire shape; and the named reply was the sole reason for
the method-name fallback in lambda tails.

- codegen: js `classes.js`, rust `handlers.js` (top-level + child arms),
  erlang `program.js` (top-level + child clauses).
- validate: the call-result shape check (c6fe13e) now knows an auto-accessor
  (own or inherited, honoring suppression / remapping) returns one positional.
  An explicit `@name` handler still takes precedence.
- removed the method-name unwrap in the `over(xs) (p) { p.m() }` special case
  (rust `expressions.js`, erlang `expressions.js`); js was removed in the
  previous session. Items now unwrap via `BvObject.one` / `bv_object_one`.
- migrated `classes/accessors.test.js`, `classes/subclasses.test.js`,
  `classes/accessors.md`.

## Open

- Auto-accessors may not survive now that there are types
  (`capability-sigils-2026-05-16.md` already leans toward deprecating them).
  This change makes their reply shape match explicit accessors either way.
- rust and erlang can't compile a list literal of child-actor constructions
  (`[C(), C()]` → `C` unbound). The two lambda-tail tests in
  `remote_call_binds` exercise it and fail on both targets.
