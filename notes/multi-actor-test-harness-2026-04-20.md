# Multi-actor test harness proposal (2026-04-20)

Follow-up note. Captures a future design for a cross-target `runActors` helper, deferred in favor of manual shepherding for the one or two tests that currently need it.

## Context

The JS target has `runActors({ actors, messages })` in `helpers.js` that:
- Compiles each source to a JS module, instantiates each as a class
- Wires each instance's `binding.post(msg)` to route between siblings by matching `msg.to` against instance names
- Collects outbound messages addressed outside the cluster into an `external` array
- Returns `external` after draining `messages`

Usage reads like a single-call integration test:
```js
const external = await runActors({
  actors: { pub: { source: ... }, sub: { source: ... } },
  messages: [
    ['sub', { id: '1', op: '@doSubscribe', ... }],
    ...
  ],
});
```

Erlang and Rust currently throw "does not support multi-actor tests" when `runActors` is called. The reason is not a language limitation — it's a test-harness scope call.

## Why it's deferred

Each Brevity actor on Erlang/Rust compiles to a standalone artifact (`.erl` + `.beam` / cargo-built binary). Running two means running two OS processes (or two Erlang VM processes). A faithful `runActors` port needs:
- Async subprocess management (spawn, keep alive)
- Async I/O routing (inspect each process's stdout for `to:` field, pipe to the correct sibling's stdin, collect externals)
- Termination detection (no global idle signal for two async subprocesses)
- Serialization overhead (JSON-over-pipes per hop, vs direct method calls in JS)

Reasonable work — estimated 1–2 days of harness code per target — but for two integration/smoke tests, it's over-engineered.

## Current approach: manual shepherding per-test

For the one or two tests that currently need two-actor interop, write them with explicit shepherding in the test body using the existing single-actor primitives:
- `createActor(source)` for each party
- `actor.sendAsync(msg)` to drive one side
- `actor.posts` to inspect outbound; find messages addressed to the other party and hand-route them with another `sendAsync`

This is more verbose (~30–50 lines per test case vs one `runActors` call) but needs no new infrastructure. Works across JS, Erlang, and Rust uniformly — the single-actor harness already handles per-target quirks (Erlang/Rust respawn-and-replay per sendAsync; JS keeps state in the same instance), and deterministic id counters mean the replay model behaves consistently.

## When to promote this to a real harness

When any of:
1. More than ~5 tests need two-actor interop — the per-test boilerplate starts to dominate
2. Tests involve **3 or more** actors, where manual routing bookkeeping gets brittle
3. Tests need to verify target-specific interop behaviors (e.g., Erlang-to-Erlang wire characteristics that don't show up at the semantic layer)

## Sketch of the eventual port

**Erlang runActors** (when we do it):
- `runActors({ actors: { pub: { source }, sub: { source } } })`
- For each actor: `writeFileSync(erlDir/<name>/brevity_actor.erl, compile(source))`, `execSync(erlc)`
- Spawn via `child_process.spawn('erl', [...])` — async, keep handles
- Pipe routing: on each process's stdout `data` event, JSON.parse the line, check `to:`
  - If matches another instance name, write to that instance's stdin
  - Else push to `external` array
- Termination: each test step is "send this external message, await quiescence (say 100ms with no activity), check externals"
- Cleanup: kill subprocesses on test finish

**Rust runActors**: same shape. cargo build each actor separately, spawn the binaries, route via their stdio.

**Shared helper**: both targets' subprocess management is ~identical — could extract a common `spawnActorProcess(binaryPath, args)` with read/write streams. The per-target concern is just compiling each source to an executable artifact.

## Cross-references

- `src/codegen/javascript/index.js` — reference `runActors` implementation (look for the binding-post routing logic)
- `__tests__/helpers.js:54-57` — the facade that currently throws on non-JS targets
- Any test rewritten with manual shepherding can serve as the spec for what `runActors` should cover on other targets
