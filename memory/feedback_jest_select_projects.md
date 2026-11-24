---
name: jest-select-projects-eats-paths
description: In this repo `--selectProjects js path` runs the whole project suite, because the flag swallows the path; use `--selectProjects=js --testPathPattern=...`
metadata:
  type: feedback
---
Scope jest with `--selectProjects=js --testPathPattern='functions/bang\.test'`. `--selectProjects js __tests__/x.test.js` treats the path as another project name and runs the full suite, which breaks [[feedback_no_full_suite_runs]].

**Why:** this started an unrequested full JS and Erlang run on 2026-11-01. The load also made unrelated Erlang tests time out, which looked like regressions.

**How to apply:** always use the `=` form plus `--testPathPattern` for scoped runs.
