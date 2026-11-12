# Cells as actors: the ordering rule — 2026-11-11

**Proposal.** Decided so far: **T3** (2026-11-11), **deferred**. T3's token is in effect a
transaction context, and cross-actor transactions are an Opre feature: the token, its
propagation, deadlock handling and atomicity are to be decided there first, as one
mechanism or two (a call chain, `tx`). Until then turns stay T2 and nothing here is
implemented. This answers the open questions in `refs-via-self-send-2026-04-09.md`
and supplies what phase B of `forward-reads-in-constructor-blocks-2026-11-11.md` rests on:
references held from an actor's start, reads that wait on any cell, and runtime cycle
detection. The protected-name wire labels it uses are in `protected-names-dot-prefix-2026-11-11.md`.

## The model

- **A cell is an actor, a child of the actor that declares it** (its owner). Its address
  is its label in the owner's frame: `.v`, `@v`, `#v`. It answers `get`, `set`, `update`
  and `subscribe`.
- **It's reached only through its owner.** The owner is its parent and translates
  addresses for it, as for any child (CAM address translation).

## The rule

1. **Per-sender order.** Messages from one sender to one receiver arrive in the order
   they were sent. Erlang guarantees this between two processes. JS and Rust must
   guarantee it.
2. **The owner's own traffic is delivered at once.** A message from the owner to one of its
   cells is handled where it's sent, inside the owner's turn, in program order. So a read
   sees every earlier write, and a `<-` needn't wait for anything.
   - **Nothing deadlocks.** The cell isn't the owner, so the owner never waits on its own
     mailbox (refs-via-self-send question 3).
   - **A direct store is a correct implementation.** Within the owner, delivering at once
     is the same as storing and reading in place. Every target may keep emitting direct
     access for the owner's own reads and writes, and the semantics are still messages
     (questions 1 and 2). That's what the targets do today.
3. **Outside traffic is held until the owner's turn ends.** A message from anyone else, to
   the owner or through it to a cell, is delivered between the owner's turns. Nobody
   outside sees the middle of a turn. A turn is a transaction over the owner's state.
4. **A cell can be pending.** Its address exists from the owner's start; its value arrives
   at its line. A `get` or `subscribe` that reaches it first waits for the value.
5. **A reference is an address with a capability.** `&v` hands out the cell's address,
   read-only. `*v` hands it out with write. A protected or private cell is reachable from
   outside only through a reference its owner handed out.

## What rule 3 leaves open: does a turn hold across an `await`?

A turn can call another actor and wait for the reply. What happens to outside traffic
while it waits decides whether callbacks work.

```
(:Svc) *{
  x *Integer = 1
  Svc.init(&x)       // Svc reads x before replying
}
```

| Option | While the owner waits | This example | Cost |
|---|---|---|---|
| **T1. Held** | nothing from outside | deadlock: Svc's read waits for the turn, the turn waits for Svc | every callback during an awaited call deadlocks, and Brevity hands out function values and references freely |
| **T2. Open** | anything | works | state can change across any `await`; `n <- n + 1` around one isn't atomic. This is JS today |
| **T3. Open to the call** | only traffic caused by the call it's waiting on | works | the wire must carry which call a message is on behalf of |

**Decided: T3.** It keeps rule 3 for unrelated traffic and lets callbacks through, and it
gives cycle detection for free:

- **A message admitted through the call chain carries that chain.** So when it reaches a
  pending cell of the owner, the cell can see that the owner is the one waiting on the
  chain.
- **That's a definite cycle.** It's the line-3 case: the cell waits on a line, the line
  waits on the call, and the call waits on the cell. The cell answers with an error
  rather than queueing.
- **A read that isn't on the owner's chain just waits** (rule 4).

### The chain on the wire

- **Each awaited call gets a token.** The caller mints it, and it's unique without anyone
  knowing their own absolute address (addresses are relative, so a chain of addresses would
  need translating at every hop). An opaque nonce does it.
- **A request carries the tokens of every call it's on behalf of:** its sender's open
  calls plus the one it's part of. Whatever is sent while handling a request inherits that
  request's tokens.
- **The tokens are hop-stable.** Like the payload, a parent passes them through untouched.
  `id` / `re` already pair requests with replies; the tokens are one more field.
- **While waiting on call K, an owner admits a message whose tokens include K.** Replies
  are always admitted. Anything else is held until the turn ends.

### What counts as inside a turn

- **Traffic the turn itself caused counts as on its chain.** This includes a child it
  constructs, and the child's reads of its cells. That keeps phase A's rule: a nested
  class's held read is answered at the cell's line, mid-construction. The child sees a
  value in the middle of the turn, but it's part of the turn.
- **Anything else sees the owner only between turns.**

## Smaller decisions

- **A write admitted to a pending cell is an error.** Under T3, an actor handed `*v` can
  write `v` before `v`'s line. Like the owner's own early write, it would be lost to the
  initializer or reordered past it.
- **`update` from outside** (refs-via-self-send question 4) carries a function, and the
  cell calls it. The function is an address (`#<@N>`), so the call is a callback, which
  works under T3. From the owner, rule 2 applies it in place.
- **Lending** (question 5): rule 5. Whether a reference must be unforgeable (signed, by
  Bluster) is out of scope here.

## What changes in the targets

Because of rule 2, the owner's own reads and writes keep their direct emission. The work
is at the edges:

- **References** become real cell addresses, routed through the owner.
- **Pending cells and queued reads** generalize phase A's held reads to any reader that
  holds a reference.
- **Turns:**
  - outside traffic is held for the turn (JS answers reentrantly today);
  - the wire carries the call chain;
  - traffic on the owner's chain is admitted during an `await`.
- **Per-sender order** gets audited in JS and Rust.

## Today: T2 everywhere

- **JS:** `receive` dispatches any message, mid-`await` included.
- **Erlang:** the wire waits handle "anything else that comes meanwhile … as it comes".
- **Rust:** `await_response` calls `self.receive` on every message that isn't the reply.

## Consequences of T3

- **Waiting actors behave like locks, so two chains can deadlock.** A, on call K1, waits
  on B, while B, on call K2, waits on A: each holds the other's message. T2 can't deadlock
  this way. The tokens make it detectable: a held message from the actor being waited on is
  an immediate cycle, and longer ones need probes along the wait-for edges (edge-chasing,
  which needs no coordinator).
- **An untrusted actor can hold a turn open.** While the owner waits on it, all the owner's
  unrelated traffic waits too. Awaited calls need a timeout or a way to abandon the turn,
  and abandoning a turn is an abort, which brings in atomicity.

## Open

- **One mechanism or two:** the call chain and transactions (`tx`), decided with Opre.
- **The wire field's name**, and whether tokens are nonces or something derived.
- **Subscriptions under rule 3.** Is a notification from a cell to a subscriber outside
  traffic for the subscriber, held until its turn ends? Probably yes; it's a message
  like any other.
- **Children's traffic.** A child's message to its parent is outside traffic for the
  parent. Today a parent answers its nested classes' reads during its own waits (Erlang
  `serveClasses`, JS reentrancy), which is T2 for that path. Under T3, a nested class's
  read made during the parent's call to it is on the chain; any other isn't.
