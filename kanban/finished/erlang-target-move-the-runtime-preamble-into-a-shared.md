---
created: 2026-11-17
---
# Erlang target — move the runtime preamble into a shared, precompiled module

Problem

Every generated Erlang module includes the full runtime preamble

(src/codegen/erlang/preambles.js, PREAMBLE: ~75 KB / ~1,700 lines), which is 75–85% of each module's source. Each test fixture therefore recompiles the same runtime. Benchmark on 14 real fixtures, idle machine:

- ~1.5 s per fixture with erlc; ~0.8 s inside a running VM
- the preamble alone takes ~0.9 s to compile in a VM Spawning a fresh BEAM per compile is not the bottleneck: batching erlc gives only 1.1×.

Goal

Generated modules contain only their own code (dispatch, handlers, state, types) and call a shared runtime module. That module is compiled once per worker and loaded once per VM, the way brevity_router is.

Scope

1. New source file, e.g. src/codegen/erlang/brevity_rt.erl, holding the PREAMBLE functions (or generated from preambles.js at build time; choose one and say which). The test runner compiles it beside brevity_router: once per worker dir, recompiled only when the source is newer than the .beam.
1. Codegen: generated modules call the runtime by remote call (brevity_rt:fn(...)). Decide between per-call remote calls and a per-module -import list: an -import keeps bodies unchanged but hides where functions come from.
1. Callbacks. The preamble currently calls functions defined in each generated module: dispatch/1, bv_read_/2, bv_run_as_/3, bv_source_key/1, bv_type_name/1, bv_unwire_reply/2. Pass the actor's module (or callback funs) into the runtime rather than relying on local calls; e.g. carry ?MODULE in the actor state or as an argument. Audit for any other implicit local reference: the receive loop, the process dictionary, ?MODULE inside preamble code.
1. Receive loop and macros. Anything that must stay in the actor's own module (the receive loop, if it can't be a remote fun; record definitions; macros) stays in a small per-module stub. Shared records/macros move to an .hrl included by both, if any exist.
1. Hot code / version safety: the runtime module is loaded once per VM and shared by every fixture module in it. No fixture may assume a different runtime version.
1. Non-test use: the Erlang host story (USAGE.md "erlc brevity_actor.erl") now needs brevity_rt.beam alongside. Update USAGE.md and any build or packaging script.

Out of scope

- Content-addressed .beam cache (a separate, smaller follow-up; most useful after this change, when only fixture code changes between runs).
- Compiling inside the router VM instead of erlc (little gain once modules are small).

Acceptance

- Generated fixture .erl size drops by roughly the preamble size; no PREAMBLE text in generated output.
- Per-fixture compile time measured before/after with the same benchmark (scratchpad erlbench/bench.mjs, or a checked-in equivalent); report both numbers.
- All Erlang tests pass; JS and Rust unaffected.
- Separate check: does the text_methods Erlang timeout under a full run persist? If so, its cause isn't compile time — investigate it on its own.
