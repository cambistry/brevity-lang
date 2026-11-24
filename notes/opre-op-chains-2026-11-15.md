# Opre op chains — 2026-11-15

Status: **proposal.** Depends on [op args always bracketed](op-args-always-bracketed-2026-11-15.md).
Companion: [subops](opre-subops-2026-11-15.md).

## The form

`op` is a sequence in reverse Polish order: `[args1] op1 [args2] op2 …`. Each `[args] op` step
operates on the result of the previous step and yields its own result. The first step's subject
is the message's `to`.

It is dot-method chaining with args and op name swapped:

| Source | Wire |
|---|---|
| `Class()` | `op: "$new", to: "Class"` |
| `Class().tweak!(123)` | `op: ["$new", [123], "tweak!"], to: "Class"` |
| `Class().first_child().created_at()` | `op: ["$new", "first_child", "created_at"], to: "Class"` |

A step with no args is the bare op name. A single-step message is the degenerate chain, so
today's messages are already chains.

## Subjects and results

- **Each step's subject is the previous step's result.** The subject changes from result to
  result: in the last example `first_child` runs on the new actor, `created_at` on the child it
  returned, and the reply is a scalar.
- **Every step but the last must yield an address.** There is nothing else to send the next step
  to. A non-address result before the last step is an error.
- **The last step may yield a value** or an address. The chain's reply is the last step's result.
- **Usually** the chained steps are `!` methods returning self, but nothing in Opre requires
  that; a step returning another actor's address moves the chain to that actor.

```js
{ id: "1", op: ["$new", [123], "tweak!"], to: "Class", ty: [["Integer"]] }
{ id: "1", re: "#<Class:1>", ty: "Class", from: "Class" }
```

## `ty`

`ty` mirrors `op` with op names (strings) removed, so it has one entry per arg list, in order.
(Subops carry their own `ty`; see [subops](opre-subops-2026-11-15.md).) A step without args
contributes no entry.

Open: whether an arg-less step should contribute `[]` so `ty` entries align with steps. The
example above would then be `[[], ["Integer"]]`.

## A chain is a transaction

- **All or nothing.** If any step fails, the chain stops, every effect of the earlier steps is
  rolled back (an actor created by `$new` in the chain included), and the reply is an error.
- **Scope: one service.** Every subject in a chain must be hosted in the same compiled program.
  There is no Opre multi-hop chaining: chaining is internal to a service, and a chain never
  crosses a service boundary.
- **Across actors in different services**, atomicity is the job of the later `tx` design
  (two-phase commit). Chains don't attempt it.

## Obligatory

Every Opre actor must implement chains. The capability may later be stated in service docs;
for now it is assumed.

## Compiler use

**Retired by `class-of-and-self-return-2026-11-23.md`:** the compiler never merges separate
calls into a chain. Only a source chain is a chain.

Consecutive calls on the same actor, with nothing else between them, may be merged into one
chain:

```brevity
actor = Class()
actor.tweak!(123)
```

emits the same `["$new", [123], "tweak!"]` as `Class().tweak!(123)`. Rebinding `actor` is
impossible, so the merged chain's result is still the address `actor` binds.

## Open questions

- **Error reply shape:** how the error identifies the failing step.
- **A subject outside the service** (an address that resolves through the parent): error at that
  step, presumably, and rollback.
- **Address accounting:** each result is relative to the actor that produced it. Within one
  program the runtime resolves these directly; the rule needs stating precisely before any
  multi-hop form is considered.
