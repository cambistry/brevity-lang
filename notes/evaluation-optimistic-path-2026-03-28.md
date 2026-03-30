# Revised Evaluation: The Optimistic Path for Brevity

*2026-03-28 — Follow-up to evaluation-brevity-vs-other-stacks-2026-03-28.md. CK addressed each hesitation; this revises the assessment accordingly.*

---

## Revisions to initial hesitations

### 1. Self-send optimization: direct call elision

Entirely viable. The compiler already knows which calls are self-sends (private function calls within the same actor). A post-codegen optimization pass could identify self-sends where:
- The target is statically known (not dynamic dispatch)
- No capture/hydrate boundary is crossed
- No type-dispatch overloading exists (single handler for that name)

In those cases, the message construction, promise wrapping, and dispatch lookup can be replaced with a direct function call. The *semantics* remain message-passing (for reasoning, testing, and capture/hydrate correctness), but the *execution* is a direct call. This is essentially what BEAM does with local calls vs. message sends — the abstraction is preserved, the overhead is removed where it's provably safe.

The important nuance: you'd want to preserve the message path for any function that *could* be captured/hydrated, since serialization depends on the string-label indirection. But that's a static analysis problem — the compiler can determine which functions are serialization-relevant.

### 2. Concurrency: swarm parallelism, not thread parallelism

The initial framing was wrong. Comparing "one actor processes one message" against "one goroutine per connection" is the wrong frame. The right frame is: a Brevity actor that needs to handle N concurrent peers spawns N child actors. The tree IS the concurrency model. Fire-and-forget (`spawn`) means the parent doesn't block. Each child handles its own conversation sequentially.

On the EVM or a BEAM target, those child actors can run on separate schedulers. On a Rust target with tokio, each could be a separate task. The language doesn't prescribe single-threading — the *actor* is single-threaded, but the *tree* is arbitrarily parallel. That's actually the standard Erlang/OTP pattern: one process per connection, not one process handling all connections.

The "distributed swarm" idea extends this further — the actor tree doesn't have to live on one machine. CAM's relative addressing means a subtree can be transparently relocated to another node. Parallelism becomes a deployment decision, not a language decision.

### 3. CAM as FFI: the actor boundary IS the foreign function interface

This reframes the question completely. In most systems, FFI means calling across a language boundary within a process (JNI, cgo, NIFs). The cost is marshalling, the risk is memory safety, the complexity is build system integration.

In CAM, the "foreign" boundary is just another actor. A BLAKE3 hasher written in raw Rust is a Rust actor that receives `hash` messages and returns digests. The wire protocol (JSON over stdin/stdout) is the marshalling layer. No shared memory, no ABI compatibility, no unsafe boundary. The cost is serialization overhead — but that circles back to point 1: for hot paths, the optimization pass could recognize same-node actors and use shared-memory IPC instead of JSON.

This is a genuinely different answer to FFI. It's slower per-call than JNI but eliminates the entire class of FFI-related crashes and memory bugs. For a p2p app where the performance-critical code is a handful of crypto operations, not a tight inner loop, this is probably the right trade-off.

### 4. Boundary types: evaluating the design, not just the implementation

The design is clear: `Signed of Request` is a different type than `Request`. The type transition happens at a trust boundary (signature verification), and the type system tracks which side of that boundary you're on. A handler that accepts `Signed of Request` can't receive `Request` — not because of a runtime check, but because the types are structurally incompatible.

If this is implemented faithfully, it means:
- Authorization logic disappears from handler bodies entirely
- Trust transitions are visible in the type signature
- The compiler can verify that no unsigned data reaches a signed-only handler
- Audit becomes "read the type signatures" rather than "trace all code paths"

The technical gap is real (it's not built yet), but the *design* gap is zero — the architecture supports this cleanly. The question is implementation difficulty, not architectural viability.

### 5. Discovery via daemon: the node IS the discovery layer

A CAM-speaking daemon on each device solves the bootstrap problem pragmatically. An application doesn't discover peers directly — it sends messages up the tree, and the daemon (as the root or near-root of the local tree) handles forwarding, queuing, and cross-device routing.

This means discovery is a service, not a protocol. An app doesn't need to implement Kademlia or mDNS — it sends a message to a well-known local address (the daemon), and the daemon handles routing. Different deployment contexts could swap in different discovery backends (mDNS for local network, relay servers for NAT traversal, DHT for global) without changing application code.

---

## Revised assessment: the optimistic path

### What Brevity gets structurally right

The core architectural decisions — type-dispatch as authorization, relative addressing, self-send for serialization, actor-tree as concurrency model, wire protocol as FFI — are not just "nice ideas." They're mutually reinforcing. Each one makes the others stronger:

- Self-send enables capture/hydrate, which enables actor mobility, which makes relative addressing useful across nodes
- Type-dispatch as authorization eliminates handler-level trust checks, which makes the "file is the actor" simplicity real rather than cosmetic
- Wire protocol as FFI means polyglot compilation isn't a party trick — it's the escape hatch for performance
- Actor-tree as concurrency means the sequential-actor guarantee isn't a limitation — it's a simplification that pushes parallelism to deployment

### The real technical gaps (for the optimistic path)

1. **Self-send optimization pass** — Without this, the performance story requires the "CAM as FFI" escape hatch for too many cases. With it, most application code runs at near-native speed. This is the single highest-leverage implementation task for credibility.

2. **Boundary type implementation** — The type = trust story is the headline feature. Until `Signed of X` actually works in the compiler, the strongest architectural argument is theoretical. This doesn't need to be complete (full Attestable hierarchy), but the basic `Signed` / unsigned distinction needs to compile and dispatch.

3. **The daemon** — Transport and discovery don't need to be solved in the language. But the daemon needs to exist as a working artifact that can route messages between actors on the same device, then across devices. Without it, every demo is a single-process toy.

4. **Multi-file composition** — The docs-planning notes identify this as the linchpin: import/export, type identity across files, compile-time dependency resolution. A p2p app is inherently multi-actor, multi-file. Until actors can reference each other's types across file boundaries, real applications can't be built.

5. **String operations and basic stdlib** — This is mundane but blocking. You can't build a real app without string manipulation, basic math, and date/time handling. These don't require deep design work — they're just implementation.

### What the optimistic path looks like

Brevity's niche isn't "better Erlang" or "better Rust." It's a language where the *application layer* of a distributed system — the handlers, the state management, the trust transitions, the coordination logic — can be written with structural guarantees that other stacks provide only through discipline. The infrastructure (transport, crypto, performance-critical paths) lives in native actors that speak CAM.

The pitch becomes: "Write your application logic in Brevity, where the type system prevents trust bugs and the actor model prevents state bugs. Drop to Rust/Go/Erlang for the infrastructure actors. They all speak the same protocol."

That's a coherent and defensible position. No other stack offers structural trust enforcement at the type level combined with polyglot actor composition. The question is execution velocity — can the five gaps above be closed before the architectural vision loses momentum.
