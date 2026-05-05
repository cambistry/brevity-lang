# Process vs. Instance — what the "process" boundary actually is

## The question

When `Self()` (or `Class()`) is called inside an actor, does each invocation
spin up a system process? The naive read of the Brevity actor model — every
actor has its own state, its own message queue — pushes toward "yes." But
that's not what we actually want.

## The asymmetry that surfaced this

Two cases that look symmetric but get treated differently today:

1. **Class hosted in a factory file**, called remotely. One process hosts the
   factory; that process holds many instances of the class; addresses are
   handed out as the factory allocates them. Single process, many instances.

2. **File-as-class** (the file's top-level constructor). Each invocation of
   `Self()` (or — under a naive reading — `Class()`) appears to spin up a new
   process, no matter how lightweight the class is.

The asymmetry feels suspicious: nothing about the language semantics demands
it. It's an artifact of how we mapped the file-as-class concept onto the
runtime.

## The actual unit: language / trust boundary, not process

The thing we genuinely care about isolating across processes is **language
and trust**:

- Different signing identities (signed code from different agents).
- Different target languages (an Erlang module talking to a Rust binary).
- Different fault domains (one OOM shouldn't take down everything).

That set is exactly what crosses a CAM boundary. CAM messaging exists because
between trust/language units, you can't pass references and call methods —
you have to serialize and route.

Inside a single trust/language unit (a file, in current Brevity), you can do
everything in-memory. There's no fundamental reason `Self()` should cost more
than allocating an object.

## What that means per target

- **JS**: each file → one realm. `Self()` → `new this.constructor()`. Already
  correct; nothing to change.

- **Erlang**: each file → one BEAM node/module. `Self()` → `spawn`. The word
  "process" here is a green thread — ~300 bytes, microseconds to spawn,
  millions per node. It's the right primitive for "isolated state +
  message-passing"; calling it the same word as `fork()` is what makes the
  asymmetry feel wrong. Keep as-is.

- **Rust**: each file → one binary. `Self()` → `Box<Actor>` (or instance entry
  in a per-class HashMap). **Not subprocess.** Subprocess is for crossing the
  language/trust boundary, not for instance allocation within it.

## Concretely: subprocess was the wrong answer for Rust

The first sketch of Rust Self() reached for subprocess plumbing — fork the
binary, pipe JSON, read responses. That conflated:

- The **outer protocol** (test driver ↔ top-level actor over stdio): legit
  CAM, JSON over stdio is correct here.

- **Inter-actor communication within the same binary**: should never
  serialize. Native Rust values, direct method calls, in-memory mailboxes.

The fix is an in-process instance pool: `<class>_instances:
HashMap<u32, HashMap<String, Value>>` on the Actor struct, allocated by
`Self()` / `Class()` for spawn-needing classes, dispatched via direct
`handle_op_at(id, ...)` calls.

## The lingering syntactic conflation

The file-as-class form makes "this file is a callable" and "each call
creates an instance" look like the same thing. They aren't:

- The file is a **trust/language unit** — addressable across CAM, isolated
  across processes only at that boundary.

- A call to `Self()` (or any constructor inside the file) creates an
  **instance** — a state container, in-process.

We probably want syntax that makes this distinction visible at some point.
Not urgent — the runtime story is clear enough now that the implementation
follows. Worth flagging for later language design.

## Decision (recorded for future load-revisit)

For now: each language/trust unit gets one host process; instances live
in-process within that unit. Per-target implementation as above.

The thing to revisit under load is *sharding* — when a single language/trust
unit has too many instances or too much traffic, how do we split it across
worker processes within the same boundary? That's a topology problem, not
the same question as "should `Self()` spawn." Worth keeping the in-process
pool design open enough to support a future shard.
