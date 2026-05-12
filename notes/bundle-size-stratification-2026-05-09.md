# Bundle size: tree-shaking, per-feature gating, stratification

**Date:** 2026-05-09
**Status:** design note. Companion to `self-send-vs-direct-call-2026-05-09.md` — the two work multiplicatively.

## The problem

A trivial Brevity program today drags in roughly the entire runtime. The JS preamble (`src/codegen/javascript/preambles.js`, 546 lines) is *partially* conditional — `STRUCTURE_PREAMBLE` and `LIST_PREAMBLE` gate on use flags (`needsPreamble`, `needsListPreamble` in `classes.js:1248–1255`) — but `DECIMAL_PREAMBLE`, `TEXT_PREAMBLE`, `MATH_PREAMBLE`, `STRING_PREAMBLE`, `EQUALITY_PREAMBLE`, and `WIRE_PREAMBLE` are emitted unconditionally. The Erlang preamble (1042 lines) follows similar habits.

So a "hello world" program ships Decimal arithmetic, regex helpers, BigInt JSON, full Math, etc. — none of which it touches. For JS this is annoying but tolerable. For WASM it's disqualifying.

## The reframe

Tree-shaking in Brevity is not an analysis problem. The compiler has whole-program knowledge — every type used, every method called, every operator applied is statically known. It's a **packaging** problem: today the runtime is bundled as a few large blobs that get emitted whole. The fix is to carve those blobs into independently-droppable units and gate each on actual reachability.

## Mechanism

1. **Per-feature gating flags.** Every preamble block becomes opt-in. A `needs` set is built during inference/codegen by visiting types, method calls, operators. `Decimal` arithmetic anywhere → `needs.add('decimal')`. Any `Blob` operation → `needs.add('blob')`. Mechanical extension of what's already done for List and Structure.

2. **Transitive use graph.** Some helpers depend on others (Decimal uses some integer helpers; Text uses Blob for byte-level ops). One pass to close the graph. Standard.

3. **Per-method gating inside method tables.** `method_tables.js` (248 lines) bundles all methods for a type. Right now if a program uses `text.length`, it gets every Text method. Should be: emit only the methods actually called. The dispatch table thins to what's reachable.

4. **Dispatch / queue infrastructure as opt-in.** This is the connection to the self-send-vs-direct-call work. If a program has zero IO boundaries (no DOM, no network, no actors that escape, no subscriptions), the entire dispatch/queue machinery can be elided. Calls become direct functions, state becomes regular variables. The queue at the host boundary only exists if there *is* a host boundary.

## Stratification

Programs naturally land in tiers. Each tier adds cost; the compiler picks the lowest tier the program actually needs.

| Stratum | Adds | Typical use |
|---|---|---|
| 0 | Just type implementations actually used | Pure compute kernels, math, parsers |
| 1 | Lean dispatch/queue shim at host boundary, direct calls within | CLI tools, embedded library, in-process actors |
| 2 | Full queue infrastructure, remote routing, address machinery | Multi-runtime (workers, processes, network) |
| 3 | Subscription tables, notify machinery | Reactive / cell subscriptions |
| 4 | HTML runtime | DOM / browser UIs |

Today's "everything always on" model is essentially compiling at stratum 4 regardless of what the program does. Most demos and CLI tools probably live in 0 or 1.

## Per-target story

- **JS:** easiest win is extending the `needs.add(...)` approach to all preambles. Bigger structural win is shipping preamble blocks as importable modules so esbuild/rollup tree-shake them at the user's bundler. That gets the JS path to "production-grade lean" with minimal compiler work.
- **Rust:** LLVM already does aggressive dead-code elimination in release builds. As long as preamble pieces are functions (not macros or always-emitted statements), `cargo build --release` strips unused code for free. We probably get most of the win without per-feature gating — but the gating still helps debug builds, compile times, and code review.
- **WASM:** depends entirely on how we get there. Via Rust → wasm-pack → wasm-opt: LLVM tree-shaking again, plus `wasm-opt -Oz` for size. If we ever emit WASM directly, we have to do it ourselves — which is why structuring everything as discrete, independently-droppable units now (rather than bundled string preambles) pays off whenever the WASM target lands.
- **Erlang:** least leverage. BEAM modules are already small; runtime atom/code lookup makes stripping unsafe in places. Probably worth the per-feature flags but don't expect dramatic cuts.

## The multiplication with direct calls

The two pieces compound. If most calls are direct (no dispatch — see `self-send-vs-direct-call-2026-05-09.md`), and stratification drops the queue/dispatch preamble entirely for stratum-0 programs, then a "Brevity for compute kernel" story becomes legitimately competitive:

- A small, sync, dependency-free WASM module
- Doing exactly one thing
- Shipping at minimal size

Today's architecture has a cost floor that makes that story impossible regardless of how clever the codegen layer is. Direct calls get the *runtime cost* down; stratification gets the *bundle cost* down. Either alone is incomplete.

## Suggested ordering

The work breaks into independent slices that can ship one at a time:

1. **Extend the existing `needs` flag pattern to the remaining JS preambles** — DECIMAL, TEXT, MATH, STRING, EQUALITY, WIRE. Smallest unit of work, immediate measurable win on JS bundle size for small programs. Inference/codegen already visit every type and operator; just record the visit.
2. **Per-method gating in `method_tables.js`** — same approach, finer granularity. Bigger win because Text/List have many methods most programs don't use.
3. **Refactor preamble blocks into importable modules (JS)** — lets bundlers do the rest. Path to production-lean JS bundles without further compiler work.
4. **Stratum-0 mode** — when the program has no actors, no IO, no subscriptions, emit it as plain functions and types. No class wrapper, no dispatch, no `receive`/`#dispatch`. Most aggressive payoff but depends on the direct-call work being in place. This is the path that unlocks the WASM compute-kernel story.
5. **Erlang and Rust per-feature flags** — lower priority. LLVM/cargo do most of the work for Rust anyway; Erlang gains are modest.

## Things to revisit

- A concrete "smallest viable Brevity program" benchmark — e.g., a hello-world and a 50-line CLI tool — measured before and after each step. Without numbers, the work is hard to prioritize against other things.
- Does `bigint_json.js` need to ship for every program, or only when Integer values cross i64? Worth checking.
- The `_bv_types` wire registry is currently emitted whole (`classes.js:1246`). Likely a candidate for "only types used at message boundaries" gating once stratification is in place.
- For the eventual WASM target: decide upfront whether we go via Rust → wasm-pack (gets LLVM tree-shaking for free) or emit WASM directly (need to build our own). The path determines how much of this work the compiler has to do versus inherits from the toolchain.
