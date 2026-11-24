---
name: Scope test runs to the target under change
description: Quick iteration can scope to js (+ the target whose codegen changed); full `npm run test` is fine during dev and expected before reporting done
type: feedback
originSessionId: 03135a67-c8b4-41d2-a2ce-3d6d8c44801b
modified: 2026-11-19T17:57:41.638Z
---
While iterating, default to the js project only. Add browser/dom when the change touches browser-specific code, and rust/erlang when it touches that target's codegen.

**Why:** tight iteration loops. Most changes are JS-behaviour changes first.

**How to apply:** prefer a filter that runs one project, e.g. `--selectProjects=js --testPathPattern=<pattern>`. Full `npm run test` runs are fine during dev too, and one is expected before reporting done (see [[no-full-suite-runs]]). The `browser` project only when browser code changed.

**No test runs for orientation (2026-10-23):** for "where did I leave off?"-style status questions, use git log and notes only. The user interrupted an unrequested `npm run test:browser` there.
