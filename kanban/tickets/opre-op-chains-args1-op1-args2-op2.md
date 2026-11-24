---
status: todo
created: 2026-11-15
---
# Opre op chains: `[args1] op1 [args2] op2 …`

Design: notes/opre-op-chains-2026-11-15.md

`op` becomes a sequence in reverse Polish order. Each `[args] op` step runs on the result of the previous step, and the first step's subject is `to`. It is dot-chaining with args and op name swapped: `Class().tweak!(123)` → `op: ["$new", [123], "tweak!"], to: "Class"`. `ty` has one entry per arg list. This assumes arg lists are always bracketed, as described in notes/op-args-always-bracketed-2026-11-15.md.

Behavior:

- Every step but the last must yield an address; a non-address result before the last step is an error. The reply is the last step's result.
- A chain is a transaction. If any step fails, the chain stops, all earlier effects roll back (including actors created by `$new`), and the reply is an error.
- Chains are internal to one compiled program: every subject must be hosted there. No multi-hop.
- Every Opre actor must support chains; this ticket covers the JS, Rust and Erlang runtimes.

Compiler:

- Emit a chain for source dot-chains.
- Merge consecutive calls on the same actor, with nothing else between them, into one chain (`actor = Class(); actor.tweak!(123)` emits the same chain as `Class().tweak!(123)`).

Open, in the note (decide or record as part of this ticket): `ty` entries for steps without args; how the error reply shape identifies the failing step; what happens when a subject resolves outside the program.

Done when: chained wire messages run on all three targets, with tests covering multi-step results, a subject that changes between steps, a non-address mid-chain error, rollback on failure, and statement merging.
