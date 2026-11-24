---
name: feedback-never-drop-failing-tests
description: "Never delete or withhold a test case because it exposes a bug, even an \"out of scope\" pre-existing one; keep it and fix the bug"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 806faf10-7254-4db3-96db-44921e4bf431
  modified: 2026-10-29T04:15:31.369Z
---

Never remove a test case because it exposes a bug, including a pre-existing bug unrelated to the current change. "Keeping scope tight" is not a reason. Keep the test, and fix the bug (or leave the test failing visibly and say so).

**Why:** The user reacted "ABSOLUTELY NOT" when I dropped a rust-failing case (`a C = C()` typed construction) from a new test file to keep a change green. Removing a test hides the bug, the same as skipping it.

**How to apply:** When a new test turns up an unrelated bug, keep the test in and either fix the bug or report it as a visible failure. Extends [[feedback-no-target-guards]].
