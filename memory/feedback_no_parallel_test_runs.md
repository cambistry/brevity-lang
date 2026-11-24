---
name: feedback-no-parallel-test-runs
description: Never run two jest/test runs at the same time (e.g. erlang + rust in background); run them one after another
metadata:
  node_type: memory
  type: feedback
  originSessionId: f6ef02ca-41d6-437a-ae71-2f3c97508ed4
  modified: 2026-11-13T15:31:05.765Z
---

Run test runs sequentially, never concurrently — not two background jest runs for different targets at once.

**Why:** the user says parallel runs are very likely to hang (2026-11-13, after I launched erlang and rust directory runs in the background together).

**How to apply:** one test command at a time; start the next only after the previous finishes. Applies to background runs too. See also [[feedback-no-full-suite-runs]] and [[feedback-test-scope]].
