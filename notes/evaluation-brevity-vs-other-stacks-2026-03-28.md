# Candid Evaluation: When Would I Choose Brevity + CAM?

*2026-03-28 — Claude's architectural assessment, focused on conceptual strengths for small-scale custom p2p applications. Assumes language and community maturity; ignores library/tooling ecosystem.*

---

## The genuine conceptual strengths

### 1. The message boundary IS the security boundary — no gap to fall into

This is the strongest idea in the system. In every other stack I'd reach for to build a p2p app — Elixir/OTP, libp2p+Go, Rust+tokio — there's a gap between "how messages are dispatched" and "how trust is enforced." You write a handler, then you write authorization checks inside that handler. The two concerns are adjacent in the code but architecturally disconnected. You can forget one.

In Brevity, the type signature on a handler IS the authorization check. A handler accepting `Signed of Request` structurally cannot receive an unsigned `Request`. There's no conditional to forget, no middleware to misconfigure. The dispatch table and the trust model are the same mechanism. For p2p apps where every message crosses a trust boundary, this eliminates an entire class of bugs.

### 2. Perspective-relative addressing solves a real problem elegantly

In p2p systems, the hardest infrastructure question is naming. DHTs, rendezvous protocols, NAT traversal — all of it boils down to "how does A address B." Most systems solve this with a global namespace (DIDs, public keys as addresses, content hashes).

CAM's tree-based relative addressing is a genuinely different answer. No actor knows its own absolute address. Routing is implicit in the tree topology. Parent actors rewrite `from` fields at each hop. This means:

- Actors are relocatable without identity changes
- No global registry or consensus on naming
- Routing decisions are local (each parent decides how to forward)
- The same actor code works whether the peer is local or remote

This is conceptually cleaner than anything I've seen in libp2p or Kademlia-based systems for small-scale applications where you don't need global discovery.

### 3. Self-send makes serialization fall out for free

Every function call — even private ones — routes through the dispatch loop as a message with a string label. This is architecturally expensive (you're paying message-passing overhead for a function call), but the payoff is real: actors become serializable without any additional mechanism. `capture` walks the state, `hydrate` restores it, and function references are just string labels. No special serialization framework, no `Serializable` interface, no edge cases around closures.

For a p2p app where you need to checkpoint state, migrate processes between nodes, or survive restarts — this is genuinely valuable. In Elixir/OTP you'd reach for `:persistent_term` or an external store. In most systems, serialization is an afterthought that becomes a headache. Here it's structural.

### 4. Polyglot compilation to a single wire protocol

The fact that an actor written in Brevity can compile to JS, Erlang, or Rust — and all three communicate via identical JSON messages over stdin/stdout — is architecturally interesting for p2p. You could have a browser-side UI actor in JS, a networking daemon in Rust, and a coordination layer in Erlang, all speaking the same protocol without bridges or FFI. The wire format (JSON with `bv-a` type attestations) is the universal interface.

---

## Where I'd hesitate vs. other stacks

### 1. The cost of "everything is a message"

Self-send means `double(5)` is not a function call — it's message construction, dispatch lookup, promise creation, and reply routing. In a tight loop or a latency-sensitive p2p protocol handler, this overhead matters. Erlang/OTP also makes everything message-passing, but BEAM's scheduler is purpose-built for this; Brevity compiling to JS or Rust carries the overhead without the runtime optimization.

For a small-scale p2p app, this probably doesn't matter. For anything with real throughput requirements (file sync, streaming, high-frequency state updates), I'd worry about it.

### 2. Sequential actors vs. concurrent reality

Actors in CAM process one message at a time. This is the standard actor model guarantee and it simplifies reasoning enormously. But p2p apps often need to handle overlapping conversations — you're syncing state with peer A while responding to a query from peer B while negotiating a connection with peer C. In Erlang/OTP, you'd spawn lightweight processes for each. In Go, goroutines. In Brevity, you'd need to decompose into a tree of child actors, each handling one concern.

This is workable but pushes complexity into the actor tree topology rather than eliminating it. The question is whether tree composition is easier to reason about than concurrent handlers. For small-scale apps, probably yes. For anything with nontrivial concurrency patterns, the single-message-at-a-time constraint could force awkward decompositions.

### 3. No escape hatch for performance-critical paths

Brevity is deliberately constrained — no general-purpose loops (only `over`, `reduce`, `repeat`), no raw memory access, no unsafe blocks. For a p2p app, there are almost always a few hot paths (cryptographic verification, protocol encoding/decoding, connection management) where you need to drop down to a lower level. Rust gives you this. Go gives you this. Even Elixir has NIFs.

Brevity compiles to these targets, but the compilation model doesn't expose an FFI story. You can't write your BLAKE3 hashing in raw Rust and call it from a Brevity actor. This means the language is useful for the application layer — handler logic, state management, coordination — but something else has to handle the infrastructure.

### 4. The type system is aspirational

The `Attestable → Signable → Signed → Ratified` trust hierarchy is described in the design documents but not implemented in the transpiler. The docs-planning notes confirm this: "The predicate/inference pattern, especially as relates to crypto" is listed as a design priority that's not in the compiler yet. Today, `bv-a` carries type attestations as strings (`"Integer"`, `"Text"`), not cryptographic assertions.

For a p2p app, the *promise* of type-level trust is compelling. The *reality* is that you'd be implementing trust validation in handler logic, same as any other stack. The structural advantage (type = trust) only materializes once the boundary type system is complete.

### 5. The missing middle layer

CAM defines the actor tree. Bluster defines the wire protocol. But between them — how does an actor on node A discover that it can talk to an actor on node B? How are edges established? How is NAT traversed? This is the "Binder" layer in the stack diagram, and from what I can see in the codebase and notes, it's designed but not built.

For a real p2p app, this is the hardest engineering. Brevity gives you a clean application-layer programming model, but the transport and discovery story is entirely open.

---

## The honest comparison

If I were building a small-scale, custom p2p application today with mature versions of all options:

| Concern | Brevity + CAM | Elixir + OTP | Rust + libp2p | Go + custom |
|---------|---------------|--------------|---------------|-------------|
| Trust boundaries | Structural (type = auth) | Manual (in handler) | Manual (in handler) | Manual (in handler) |
| State serialization | Free (capture/hydrate) | Manual | Manual | Manual |
| Addressing | Relative (elegant) | Named processes (global) | PeerID + multiaddr | Custom |
| Concurrency model | Sequential actors + tree | Lightweight processes | async tasks | goroutines |
| Performance ceiling | Constrained | High (BEAM) | Very high | High |
| Escape hatch | None (by design) | NIFs | unsafe {} | cgo |
| Transport layer | Not built | :gen_tcp, libcluster | Built-in | net package |
| Wire protocol | JSON + bv-a | Term format / custom | Protobuf / custom | Custom |

---

## When I'd choose Brevity

- The app is primarily about coordinating state and trust between a small number of peers
- Message volume is moderate (not streaming, not high-frequency)
- The trust model is complex enough that structural enforcement pays for itself
- I want actors to be relocatable or serializable without extra work
- The team is willing to handle infrastructure (transport, discovery) separately

## When I'd choose something else

- There are performance-critical paths that need low-level control
- The app needs concurrent handling within a single logical entity
- Transport and discovery are part of the problem (not just the application layer)
- The trust model is simple enough that a few `if` checks suffice

---

## The bottom line

Brevity's strongest argument is that it makes the *correct thing easy and the wrong thing structurally impossible* for trust and message handling in distributed systems. That's a genuine advantage most stacks don't offer. The weakest point is that it solves the application layer cleanly while leaving the hardest infrastructure problems (transport, discovery, performance) to other tools.

For a peer-to-peer app where the hard problem is "what happens when this message arrives and can I trust it" rather than "how do I get messages between nodes efficiently" — Brevity is a meaningfully better fit than general-purpose alternatives. The actor-tree model, relative addressing, and structural trust boundaries are real ideas that would reduce bugs and simplify reasoning. The question is whether the infrastructure gaps can be filled without undermining the elegance.
