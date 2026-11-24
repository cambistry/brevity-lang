---
name: git-branching-discuss-first
description: "Don't create a git branch without discussing it first; surface the choice"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 800393bf-869e-4e89-b6e2-9a38d0c1054e
  modified: 2026-10-28T01:22:38.916Z
---

The user was not thrilled that I opened a feature branch (`feat/lambda-param-inference`) on my own when they'd asked me to commit — I did it silently on the "don't commit to the default branch" convention. They let it stand ("no harm no foul") but flagged it.

**Why:** branching is a workflow decision the user wants a say in, not something to infer from a default. Committing directly on `main` may be fine for this repo/user.

**How to apply:** when work is about to be committed and I'm on the default branch, surface the choice in one line (branch vs. commit on main) and let the user decide, rather than auto-branching. If they've said to commit, default to doing it where they are unless they ask for a branch. Still never push without being asked. Relates to [[commit only when asked]].
