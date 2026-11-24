---
name: testing
description: How to run tests (scoping, full suite, one at a time, jest flag trap, rust cache/workspaces) and how to write them
metadata:
  type: feedback
---

## Running
- **Iterate** with js only: `--selectProjects=js --testPathPattern=<pattern>`. Add rust or erlang when their codegen changed, and browser/dom when browser code changed.
- **Trap:** always use the `=` form. In `--selectProjects js path`, the flag swallows the path, so the whole suite runs.
- **Before reporting done,** run the full js project (`--selectProjects=js`) as a smoke test, then `npm run test` (js, erlang, rust, dom; about 3 min). Add `browser` only for browser code. Scoped js runs miss cross-target failures.
- **Run one test process at a time,** background runs included. Parallel runs hang, and two rust runs share `rust/w{N}` workspaces and poison the cache.
- If the user says they're running the suite, don't start one.
- Never run tests to answer a status or "where did I leave off?" question. Use git log and notes.
- **Report faithfully.** Fix every failure.

## Never hide a failure
- No per-target skipping by any mechanism: describe guards, `excludeTests` in `jest.json`, ignore patterns, file naming, or early returns. A feature on one target leaves the others red; that red is the port's to-do list. Say "breaks other targets; port pending" in the commit.
- Never drop or withhold a test because it exposes a bug, even an unrelated one. Keep it, and fix the bug or report the failure.

## Rust
- `rust/cache/` self-invalidates (keyed by code hash, swept by mtime), so don't clear it as a routine step. Suspect it only when results are inexplicable, and ask before deleting.
- Scratch builds use a scratchpad `CARGO_TARGET_DIR`, never `rust/w*/target`. That once cached wrong binaries.
- Replies from other programs, or `unhandled` from code that works by hand, mean a polluted workspace or cache.

## Writing tests
- Read a neighbouring test in the same directory first and match it. Models: `__tests__/keywords/self_as.test.js`, `core_types/structure.test.js`.
- One script per describe, and one or two runtime describes per file. Each script is a Rust build, so fold cases into the script.
- Use `__tests__/helpers.js` (`expectBehavior`, `createActor`, `expectActorBehavior`, `compileActor`) directly. No in-file wrappers, step builders or assertion helpers.
- Each `it` is a literal step, `expectBehavior(script, { input }, { output })`, matching the exact reply. Use `objectContaining` only for fields that really vary.
- This applies to multi-actor and wire tests too: no `ask`/`network` wrappers, no asserting on `posts` or `net.external`.
- No `\n`-escaped Brevity in test source.
- Compile errors: `expect(() => compileSource(...)).toThrow(...)`, one source per case. State rules, not lists of bad spellings.
