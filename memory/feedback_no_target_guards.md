---
name: No per-target test skipping (any mechanism)
description: Never skip/hide tests per codegen target — no describe guards, no jest.json excludeTests, no per-target ignore patterns, no file naming that dodges one project. Tests that fail on Erlang/Rust MUST fail visibly.
type: feedback
originSessionId: 0ad23c2f-93a4-4d51-8932-0363758b5e8a
---
**Rule:** Do not skip tests on any codegen target by any mechanism. Every test file in `__tests__/` must run against every configured jest project (js, erlang, rust, browser). If a feature is implemented on only one target, let the tests fail on the others — that failure is the signal.

**Prohibited mechanisms** (all equivalent violations):
- `describeJsOnly`, `itIfTarget`, any `describe.skip`/`it.skip` gated on `BREVITY_TARGET`
- `excludeTests` in `src/codegen/<target>/jest.json`
- Custom `testPathIgnorePatterns` that single out per-target paths
- File naming conventions that exclude via glob (e.g., "`.js-only.test.js` is filtered out of other projects")
- Runtime early-return in test bodies based on target

**Why:** The test suite IS Brevity's uniformity contract. Hiding tests per-target silently condones drift — a feature "works" because the failing tests never run. The user relies on red CI across targets to know what's still to port. Skipping breaks that signal. User flagged this with full emphasis on 2026-04-19 after I violated it twice in the same session (first via `describeJsOnly`, then via `jest.json` exclusion — the same sin at a different layer).

**How to apply:**
- When landing a feature on one target first, write the tests and let them fail on the others. Red CI on Erlang/Rust is the TODO list for the port.
- If test-harness infrastructure differs per target (e.g., JS has `runActors` that Erlang/Rust don't), the `helpers.js` function should throw on unsupported targets and the test will fail — that's fine, it's still visible.
- Commit messages for one-target-first work should state plainly "this breaks the other targets; port pending."
- Do NOT interpret an "exception" clause elsewhere as permission to skip. There is no permitted mechanism.
