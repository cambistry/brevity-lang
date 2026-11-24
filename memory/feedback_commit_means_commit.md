---
name: commit-means-commit
description: "When asked to commit, just commit; don't run tests first, the user runs them"
metadata:
  node_type: memory
  type: feedback
  originSessionId: e34ce06c-a978-452a-90aa-73112bba359a
  modified: 2026-11-01T21:15:06.196Z
---

When the user says "commit", commit straight away. Don't run tests or lint first, not even scoped to one file.

**Why:** the user runs the tests themselves and was annoyed when I ran them before a requested commit ("I asked you to commit, not to run tests... *I* am running tests!").

**How to apply:** go straight to `git commit`, with only a look at the diff to write the message. Related to [[no-full-suite-runs]].
