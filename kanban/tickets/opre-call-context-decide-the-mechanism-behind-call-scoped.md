---
status: inbox
created: 2026-11-12
---
# Opre call context: decide the mechanism behind call-scoped turns and transactions

**Background.**

- An actor handles one message at a time; handling one message is a **turn**. A turn can call another actor and wait for the reply. The question is what the actor does with other incoming messages while it waits. There are three options:
- **Closed:** hold all of them until the turn ends. Any callback made during the awaited call deadlocks.
- **Open:** handle any of them. State can change across any await. This is what JS, Erlang and Rust all do today.
- **Call-scoped:** handle only messages caused by the call being waited on, and hold the rest until the turn ends. Callbacks work, and unrelated traffic never sees the middle of a turn.
- **Call-scoped turns are the chosen direction.** They need a token on the wire that marks which call a message is on behalf of.
- That token is in effect a **transaction context**. Call-scoped turns give isolation along a call chain: they are the nested-transaction rule that a child inherits its parent's locks. There is no atomicity, commit or durability yet.
- Cross-actor transactions are planned as an **Opre** feature, with no trusted coordinator across trust boundaries. Defining a Brevity-only field for the token now (on was the working name) would get ahead of that design. The work that needs it is deferred until this is decided.

**Questions to decide.**

1. **One mechanism or two.** Is the call chain the base that transactions (tx) build on? Is a transaction context the primitive, with a call chain as its simplest case? Or are they separate fields?
1. **The token.**
- How it's minted and what format it has.
- How it stays unique when no actor knows its absolute address. Addresses are relative and rewritten at each hop, so the token can't be built from addresses.
- Where it sits in Bluster's split between hop-mutable headers and the signed payload, and whether it's signed.
1. **How it propagates** through:
- a request handler and everything it sends;
- replies;
- children constructed during a turn;
- subscriptions and emits;
- fire-and-forget (...) calls;
- parent address translation.
1. **Admission.** The exact rule for which messages a waiting turn handles, and what counts as inside a turn. Current proposal: traffic the turn itself caused, including children it constructs and their reads of its cells.
1. **Deadlock.** Call-scoped turns make waiting actors behave like locks, so two chains can wait on each other. For example: A, handling call 1, waits on B, while B, handling call 2, waits on A. Each holds the other's message. Decide:
- how this is detected: an immediate check when the held message comes from the actor being waited on, and probe messages along the wait-for edges for longer cycles;
- how it's resolved: which turn gives way, and what it gets back.
1. **Timeouts and untrusted peers.** An actor across a trust boundary that never replies can hold a turn open. Meanwhile all of the owner's unrelated traffic waits. Is the remedy a timeout, a way to abandon a turn, or an abort?
1. **Atomicity.** Is abort/rollback in scope now or later? How does it interact with:
- the ! write suffix (notes/mutation-suffix-2026-10-31.md);
- untracked cells, which aren't rolled back;
- fresh actors, which are discarded on abort;
- committing across trust boundaries without a coordinator?
1. **Targets.** Map what each runtime (JS, Erlang, Rust) must change to move from open turns to call-scoped ones.

**Deliverables.**

- A design note in notes/ answering 1–8.
- The wire field name or names.
- A test plan outline for the eventual implementation.
- No code.

**Unblocks** the deferred work in notes/forward-reads-in-constructor-blocks-2026-11-11.md (its "Staging" section):

- handing another actor a reference to a cell before the cell's declaration;
- reads by other actors that wait for a cell's first value;
- detecting at runtime a construction that waits on itself through another actor.

It also unblocks isolation across await in every handler.

**Not affected:**

- A nested class's construction can read a cell of its enclosing class declared below it. The read waits for that line.
- An inline singleton (s = **{ … }) runs its block in program order.
- An actor reading or writing its own cell before the cell's declaration is a compile error.

**Background reading:** notes/cells-as-actors-ordering-2026-11-11.md (the cells-as-actors proposal, where the three options are labeled T1/T2/T3) and notes/refs-via-self-send-2026-04-09.md (the earlier open questions).
