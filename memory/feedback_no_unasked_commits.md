---
name: no-unasked-commits
description: "Never commit unless the user explicitly says to commit, in general — not after finishing a fix, not as a checkpoint"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 3fd3c96d-be2c-4702-8c5b-fc4e0150a73f
  modified: 2026-11-13T22:43:36.555Z
---

Don't commit until the user says so, in general (stated emphatically 2026-11-03: "Don't commit until I say so" / "IN GENERAL").

**Why:** I committed fixes and tests on my own as natural checkpoints (a34eb08, 6042bf7, ce81ba1) after the user had asked for earlier commits; they want to review before anything lands.

**How to apply:** finish work, run tests, report — leave changes uncommitted. An earlier "commit" request covers only that moment's work, not later work. "Proceed" after a review is not a commit signal: on 2026-11-13 the user's ticket said "commit as necessary", then they reviewed it and said "Proceed" with a rework, and committing that rework (9d534ee) jumped the gun. Related: [[commit-means-commit]] (when they do ask, just commit), [[git-branching]].

**Exception (2026-11-19):** in a self-supervised run, where the user has queued several tickets and said I'm working through them on my own, each ticket goes green > commit > continue. See [[no-full-suite-runs]].
