# Class instances share state on rust and erlang — 2026-10-29

OPEN. Found while chasing the lambda-tail failures in
`destructure/remote_call_binds` (`session-2026-10-29-remote-bind-single-value.md`).

## Problem

On rust and erlang an ordinary class compiles to one shared (flattened) set
of state on its parent. Constructing it twice reuses that state, so the
second construction overwrites the first:

```
C = (@n Integer) *{ @x = -> 1 }
@run = { a = C(1); b = C(2); x Integer = a.n(); y Integer = b.n(); return r: x * 10 + y }
```

js `r: 12`; rust and erlang `r: 22`.

Per-instance state exists only where `classNeedsSpawnedInstances` holds — a
class that refers to `Self` (rust: instance pool + `child_<c>_dispatch_at`;
erlang: spawned processes + `{bv_dispatch, …}`). That's why `self/peer_list`
works.

## Consequences

- Any program constructing a class more than once is wrong on two of three
  targets.
- Construction in expression position doesn't compile: `[C(), C()]` (rust:
  `cannot find value C`, emitted as `self.call_fn(&C, …)`; erlang: unbound
  `C`). Compiling it would still yield one actor twice.

## Failing tests (left visible)

- `classes/instances.test.js` — two instances; list of instances.
- `destructure/remote_call_binds` — the two lambda-tail cases.

## Direction

Generalize the spawned-instance path to every class on rust and erlang:
`C(args)` yields a fresh instance reference in any expression position; calls,
field reads/writes, `<-`, subscriptions and wrapped superclasses dispatch
through it. Keep flattening only as a proven-single-construction optimization,
or drop it. Every child-class codegen path on both targets assumes the
flattened layout (state keys `b_<field>`, `_supertypeBindings`, the `over`
special case), so this is a dedicated piece of work.
