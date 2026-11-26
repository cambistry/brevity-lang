---
status: inbox
created: 2026-10-29
---
# Optimisation: flatten single-construction classes on rust and erlang

Today: every class instance now gets its own state on rust and erlang, via the spawned-instance path (rust: instance pool plus child_<c>_dispatch_at; erlang: a spawned process per instance). Before that change, an ordinary class compiled to one shared set of state on its parent. That was faster, with no instance lookup and no process hop, but wrong whenever a class was constructed more than once.

Want: this ticket brings flattening back as an optimisation, applied only where it's provably safe. Flatten a class (state inlined into the parent, direct dispatch) only when the compiler can prove it has exactly one live instance:

- It's constructed exactly once, in the parent's constructor block or file init: not in a handler, loop, lambda, list literal or argument.
- That instance's reference never escapes: it isn't returned, passed as an argument, stored in a collection or another actor's field, or published.
- The class doesn't refer to Self, which always needs real instances.

Everything else stays on the spawned-instance path.

**Open questions**

- Is "never escapes" too strict? A reference passed to a private function and used only locally might still be safe.
- Erlang: a spawned process may cost little enough that only rust is worth optimising. Measure first.
- Debuggability: flattened and spawned classes must behave identically (state keys, subscription and re-emission order, #capture/#hydrate snapshots). Each optimised shape needs a differential test.

**Acceptance**

- Benchmarks on rust (and erlang, if pursued) show a meaningful gain on a single-instance-heavy program; otherwise close the ticket.
- No behaviour change: every test in classes, self, destructure, operators, types and cam gives the same results with flattening on and off. A compiler flag to turn it off, for differential testing, is part of the deliverable.
- classes/instances.test.js keeps passing, so multi-construction is never flattened.
