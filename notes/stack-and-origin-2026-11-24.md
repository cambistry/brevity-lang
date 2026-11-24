# The stack and where it came from — 2026-11-24

## The stack, top to bottom
1. **Brevity** is the constrained app-definition language. It compiles to JS (plus a browser variant), Rust and Erlang.
2. **Opre** (formerly CAM) is a polyglot actor tree.
   - Messages are plain JSON.
   - Actors are sequential and don't know their own address; parents translate addresses on the way out.
   - Everything is async.
3. **Binder** is the vertex-level messaging protocol.
4. **Bluster** is the authenticated, content-addressed wire.
   - Digests are JCS (RFC 8785) with BLAKE3; URIs are `bluster://`.
   - The hop-mutable `from`/`to` are kept apart from the signed payload.
   - Node bind is a rare three-step handshake; vertex bind is light.
5. **Topology.**
   - A node is a daemon, and a security boundary.
   - A vertex is an addressable endpoint.
   - An edge is a symmetric record, `hash(sort(a, b))`.

## Trust types
- `Attestable` → `Signable`/`Cosignable` → `Signed`/`Cosigned`/`Ratified`.
- Boundary types (`Signed of X`) are state transitions: the type system and the trust system are one concern.
- An agent is a principal: it signs and is accountable.
- A vertex or a node is a process.
- A delegate is a bounded capability given by an agent to a vertex.

## Origin
Opre and Brevity grew out of work on blockchain cross-chain transactions, which has three consequences:
- Cross-actor transactions are a planned Opre protocol feature, not an add-on.
- The design doesn't assume a trusted coordinator across trust boundaries.
- MCP's lack of atomicity across tools is a key contrast.
