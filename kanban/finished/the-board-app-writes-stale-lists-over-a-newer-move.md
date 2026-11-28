---
created: 2026-11-26
---
# The board app writes stale lists over a newer move

The open board app saves whole `lists/` files from its memory, so a drop made in it can undo a move made elsewhere (another machine, or a session moving a ticket with git) since its last sync. Seen twice on 2026-11-26:

- `b303e5b` (a session: destructure-a-core-type-s-functions to Review, filter-find-map-sum to In Progress), then `3d4b0a4` five minutes later from the board: both lines back where they were.
- `bc99973` (a session: double-check-for-dead-code-paths… to Review, an-unannotated-bind… to In Progress), then `ccd5f9b` a minute later from the board, its exact inverse, during a run of board edits.

Want: a drop changes only the lines it moves, applied to the lists as they are on `origin/kanban` (fetch and rebase, or re-read the files, before writing), so a concurrent move survives.

**Done (2026-11-27):** every order change (drop, new, delete, adopt) is one queued step: rebase
onto origin, re-read lists/, re-apply only that change (a drop by its neighbours), write, commit,
push (kanban/board.mjs `change`). Checked with a scripted run against a scratch repo: a session's
pushed move made while the board was open survives a later drop in the board.
