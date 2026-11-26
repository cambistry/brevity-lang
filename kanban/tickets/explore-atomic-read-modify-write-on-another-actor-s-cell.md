---
created: 2026-11-17
---
# Explore: atomic read-modify-write on another actor's cell

Background: discussion of 2026-11-16.

Today: a write to a cell owned by another actor, computed from that cell's own value, is two messages: a read, then a `$set`. Another writer can land in between, and an update is lost.

```
D = (n Integer) *{ class::total <- class::total + 1 } ^ { total *Integer = 0 }
```

Build two actors at once and `total` can end at 1. The same applies to every write from an inner scope to an enclosing actor's cell (OuterSet), to a class block's cell from its instances, and to a parent class block's cell under the delegated rule. Remote parents make it worse.

Today: within one actor, its own cells are safe only while a handler doesn't await between the read and the write. Turns are reentrant (T2).

Directions to evaluate

1. Compile it away. When the right side of `x <- …` reads `x` and nothing else out-of-actor, send a single op that the owner computes: `$update` with an operation, or a small set of intrinsic ops (`$add`, …). Check what `<|` / `$update` does today. Limited to expressions the owner can evaluate from the message alone.
1. A block run as one turn of the owner: `within class { total <- total + 1 }`, the body run by the cell's owner, captured locals copied in by value. A keyword leads, so there's no clash with construction (`class { … }` could be a block argument). Atomic only if the body doesn't await another actor.
1. Opre op chains (notes/opre-op-chains-2026-11-15.md): a chain is a transaction on one service, so `$get`, then compute, then `$set` as one chain at the owner.
1. Compare-and-set (`$cas` with old and new values) plus a retry loop in the writer.
1. Call-scoped turns (T3, notes/cells-as-actors-ordering-2026-11-11.md): decided but deferred, its token to be designed with Opre's `tx`. Does T3 subsume this?

Questions to answer

- Should a plain `x <- x + 1` on a non-local cell be atomic automatically, since programmers will read it as atomic, especially in the nested form where it looks local? Or should it stay two messages, with an explicit form for atomicity? Or be a compile error / warning unless written atomically?
- What a block run at the owner may contain: calls to other actors, awaits, replies, writes to several of the owner's cells.
- What the owner sees: its own cells bare inside the block, by whose visibility (protected for family, private never)?
- Interaction with subscriptions: one notification per atomic update, not per message.
- Remote owners: the trust boundary (code shipping vs intrinsic ops), and how each option maps onto Opre.
- Errors and ordering: what a failed or refused atomic update looks like to the writer.

Deliverable

- A note in notes/ choosing a direction (or a combination: say, automatic for simple expressions plus an explicit block), with the reasoning and the rejected options.
- A test that shows the lost update today. Build it deterministically: interleave two writers' messages in the harness rather than relying on timing. Then the tests for the chosen form, on js, rust and erlang. Exploration first; implementation follows under its own ticket.
