---
name: stack-background-concepts
description: Bluster wire protocol, trust-type system, topology (node/vertex/edge), principals vs processes — background for the lower stack layers
metadata:
  type: project
---

### Bluster Protocol
- Wire protocol: content-addressed, cryptographically authenticated
- Separates hop-mutable routing headers (`from`/`to`) from stable signed payload
- Uses canonical JSON (RFC 8785 JCS) for digests
- Node binding = 3-step handshake (rare, expensive)
- Vertex binding = lighter, frequent, piggybacked on node bind
- URI scheme: `bluster://` (not `vertex://`)
- Daemon: durable queue (sqlite), XPC/Unix sockets IPC

### Type System
- `Attestable` → `Signable` / `Cosignable` → `Signed` / `Cosigned` / `Ratified`
- Boundary types: the type system and trust system are the same concern
- Type symbols: path + content hash for cross-app identity
- Time is intrinsic to signature verification (check identity was valid at signing time)

### Topology
- Node: daemon/process (security boundary)
- Vertex: addressable actor/app endpoint, UUID assigned by node
- Edge: first-class symmetric record (`edge_id = hash(sort(a, b))`)
- Canonical edge objects in `edges/`; per-vertex adjacency indexes in `index/`
- Content addressing: BLAKE3 (not SHA256)

### Principals vs. Processes
- Agent = principal, can sign, accountable
- Vertex/Node = process, runs code, not accountability unit
- Delegate = bounded capability token from agent to vertex
- Sanity check: signs/authorizes = agent; gossips/syncs = vertex

See also [[cam-actor-model]] in MEMORY.md and the repo's concepts/ notes.
