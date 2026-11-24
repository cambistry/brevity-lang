---
name: feedback-rust-scratch-builds
description: Never point CARGO_TARGET_DIR at a test workspace (rust/w*/target) for scratch builds
metadata:
  node_type: memory
  type: feedback
  originSessionId: 3a391202-6e3f-41fb-8301-8432b220b74d
  modified: 2026-10-29T21:57:59.144Z
---

Scratch-compile generated Rust only into a scratchpad target dir, never `rust/w*/target`.

**Why:** On 2026-10-29 a scratch build with `CARGO_TARGET_DIR=rust/w7/target` (a second `brevity-actor` package sharing the target dir) let test builds in w7 skip relinking; the harness cached wrong binaries, and the user's rust suite showed nonsense failures (replies from other test programs) until they flushed `rust/cache` and `rust/w7/target`.

**How to apply:** Use a target dir under the scratchpad. If rust results look like another program's output, suspect a polluted workspace/cache before codegen. Relates to [[feedback-rust-cache]].
