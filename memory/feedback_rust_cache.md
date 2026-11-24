---
name: rust-cache-no-routine-clearing
description: "rust/cache/ entries are dated and self-invalidate; don't clear it as a routine step. Only suspect it when rust results are inexplicable."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 806faf10-7254-4db3-96db-44921e4bf431
  modified: 2026-11-07T00:18:04.730Z
---

Clearing `rust/cache/` is NOT required under normal circumstances — cache entries are dated (keyed by generated-code hash, swept against test-file mtime). Don't make clearing a routine pre-run step or flag it as a caveat.

**Why:** User correction (2026-10-28), repeated 2026-11-02: never clear it reflexively, because it really slows down acceptance. Earlier guidance said to always clear it; that was over-cautious.

**Never run two rust jest processes at once** (e.g. a background run plus a foreground one): they share the `rust/w{JEST_WORKER_ID}` workspaces, overwrite each other's `main.rs`, and cache binaries under the wrong hash. The symptom is a test that fails with `unhandled` while the same generated code built by hand works. This happened on 2026-11-06; I removed the poisoned entries by meta mtime (only the ones from that session).

**How to apply:** Run rust tests directly, one jest process at a time. Only if rust results are inexplicable (e.g. a value that matches old source) consider stale cache, and ask the user before deleting it.
