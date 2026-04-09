# Refs via self-send — follow-up to SSA immutability work

**Status:** deferred follow-up to the SSA / const-only binding change (2026-04-09).
**Predecessor:** see `ssa-immutability-2026-04-09.md` for the phase-one plan.

## The thesis

In a functional actor model, the only mutable state is what the actor owns: its
ref set (`*x`, `*y`, …) and its child actors. Locals are immutable, period —
phase one (SSA) delivers that.

Phase two extends the same honesty to refs. A lambda or handler that reads or
writes `*x` does **not** directly reach into a shared mutable cell. It sends a
message to the owning actor (usually self), and the actor's handler dispatches
the read/write against its own state. The only thing a lambda physically
captures is immutable snapshots plus an actor reference.

Outcome: capture becomes trivial (snapshot-by-value only), lambda lifting
becomes universally safe, `lambdaUsesOuterRefs` becomes dead code.

## Current state of ref access (2026-04-09)

None of the three backends use self-send for plain refs today. All three use
direct access to a local mutable cell, with different physical representations:

| Backend | Read | Write | Storage |
|---|---|---|---|
| Erlang | `get(ref_x)` | `put(ref_x, V)` | process dictionary |
| JS | `x.value` | `x.value = V` | `const x = {value: …}` shared object |
| Rust | `self.state.get("ref_x")` | `self.state.insert("ref_x", V)` | `HashMap<String, Value>` field |

Source: `erlang/statements.js:257,269`, `erlang/expressions.js:159`,
`javascript/statements.js:60-65`, `javascript/expressions.js:191`,
`rust/statements.js:1375,1391`.

**Child-actor refs are already partly message-shaped.** Operations on child
actors go through `child_foo_handle_op(OpName, Meta, Payload, Id, From)` in
Erlang (`erlang/statements.js:266`), `self.child_foo_dispatch("::set", payload)`
in Rust (`rust/statements.js:1382`), and `this.#send(...)` in JS. These are
synchronous in-process calls but the shape is a message. So the child-actor
path is a partial precedent — phase two extends the same shape to plain refs.

## What changes

### Runtime representation

- **JS:** refs stop being `{value: …}` objects. They become state fields on the
  actor class (`this.#x`), and access goes through a dispatch-shaped interface.
  Lambdas no longer close over the cell object.
- **Erlang:** `put(ref_x, V)` and `get(ref_x)` get wrapped in (or replaced by)
  handler calls. Could reuse the `handle_op` pattern already used for child
  actors.
- **Rust:** similarly, direct `self.state` access gets wrapped.

### Read/write code paths

- `RefRead` and `SetStatement` emission stops producing direct cell access. They
  produce (conceptually) `self ! {read, x}` / `self ! {write, x, V}` — or the
  synchronous in-process equivalent, matching the child-actor pattern.
- Inside a handler that already has `self`'s state loaded, these could be
  inlined back to direct access as an optimization. The *semantic* model is
  message-mediated; the emission is a peephole optimization on top.

### Lambda capture

- `collectFreeVars` stops needing special-case ref detection.
- `lambdaUsesOuterRefs` (`javascript/expressions.js:95-113`,
  `erlang/types.js:194-247`) becomes dead code and can be deleted.
- Lambda lifting (`javascript/statements.js:341-369` and the Erlang/Rust
  analogs) stops having an "inline because of outer refs" branch. Every lambda
  is liftable; every capture is a snapshot.

## Open questions (must resolve before scoping)

1. **Ordering / reentrancy.** Today `a <- 1; b <- a + 1` inside one handler is
   two direct writes with an intervening direct read. Under self-send, is the
   sequence still synchronous? If yes, what does the self-send wrapper actually
   buy over direct access — just the lambda-lifting cleanup? If no (enqueue and
   drain later), the two writes straddle a message boundary and `a + 1` might
   read a stale value. That changes handler semantics in a way that needs test
   cases to pin down.

2. **Performance in tight loops.** Any loop that updates a ref repeatedly (a
   counter, an accumulator) will emit many self-sends. If those are
   semantically equivalent to direct access, the peephole optimization is
   mandatory, not optional.

3. **Re-entrancy during dispatch.** If handler A does a self-send to read `*x`,
   and dispatch is one-message-at-a-time, does A deadlock waiting for its own
   reply? Some kind of "inline read" fast path is probably required.

4. **Update semantics (`<|`).** The update operator applies a function to the
   current value. Under self-send, that's a message that carries the function.
   For polyglot actors this means serializing the function — either as a named
   handler reference or as bytecode. Today JS/Erlang just inline the function
   call. Needs a concrete design.

5. **Refs as function parameters (`&x`, lending).** Passing `&x` today passes a
   reference to the cell. Under self-send, what travels instead — an actor
   reference plus the ref name? A capability token? This is the intersection
   with the lending story and needs thought.

## Dependencies

- **Phase one (SSA) must land first.** Phase one removes rebinding ambiguity,
  which simplifies the mental model for phase two. If phase two lands first,
  any bug hunt would have to disambiguate "self-send broke" from "rebinding
  capture is lying to me."
- The child-actor dispatch path already does most of what phase two needs for
  plain refs. Whatever the refactor lands on, it should reuse or generalize the
  existing `handle_op` / `child_foo_dispatch` pattern rather than invent a new
  one.

## Success criteria

- `lambdaUsesOuterRefs` is deleted from all three backends.
- Every lambda is liftable; the "must stay inline because of outer refs"
  branch is gone.
- Lambda capture contains only post-SSA immutable snapshots plus an actor
  reference. No ref cells.
- Open questions 1–5 above are each answered with a test case that pins the
  chosen behavior.
- All three backends emit ref access via the same dispatch-shaped interface
  (not necessarily the same runtime mechanism, but the same shape at the
  codegen call site).

## Not in scope

- Changing the `*x` / `<-` / `<|` *syntax*. The source language is unchanged.
- Changing child-actor dispatch. That path is already message-shaped.
- Changing how refs interact with the type system (`Attestable`, `Signable`,
  etc.). Refs are still refs; only the access mechanism changes.
