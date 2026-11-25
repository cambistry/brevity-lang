# Kanban

Tickets are `kanban/tickets/<slug>.md`, tracked on `main` with the work:

```
---
status: inbox
created: 2026-11-24
---
# Title

Description: the problem, the expected behaviour, and pointers
(tests, notes/, source files).
```

`status` is the column. A status change goes in the same commit as the work it reflects.

Columns: `investigation`, `inbox`, `todo`, `in-progress`, `review`, `done`, `future`, `wont-do`, `icebox`.

## Board

Order within each column lives on the `kanban` branch, checked out as a gitignored worktree at `.kanban/`. It holds only `lists/<status>`, one repo-relative ticket path per line. The app (`kanban/board.mjs`) and its `columns` file are on `main`. That branch shares no history with `main`, so reordering never appears in `main`'s log.

Setup, once per machine:

```
git fetch origin kanban
git worktree add .kanban kanban
```

(Before the branch is on origin, the first machine creates it with `git worktree add --orphan -b kanban .kanban`.)

Run `npm run board`.

- Arrows (or `hjkl`) move the cursor; `g`/`G` and PgUp/PgDn jump.
- Four columns show at a time; moving past the edge scrolls them (`‹`/`›` mark hidden ones).
- Enter shows the ticket; Enter or Esc returns.
- Space grabs a card; arrows carry it within or across columns; space drops it, Esc cancels.
- `e` edits in `$VISUAL`/`$EDITOR`, `n` creates a ticket at the top of the current column, `r` reloads, `q` quits.

Each drop commits `lists/` on `kanban` and pushes it. While open, the board fetches every 15 s (`KANBAN_POLL` seconds) and rebases onto other machines' moves. The lists decide the columns: a move shows on other machines as soon as `kanban` syncs. It also edits the ticket's `status` on `main`, which stays uncommitted until the work is committed; the quick-view flags a ticket whose front-matter lags its column. A ticket in no list goes by its front-matter, at the top.

`npm run board -- --print [status…]` prints the board as text.
