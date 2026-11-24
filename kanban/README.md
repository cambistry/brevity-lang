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

Columns: `investigation`, `inbox`, `todo`, `in-progress`, `review`, `done`, and the parked `future`, `wont-do`, `icebox`.

## Board

Order within each column lives on the `kanban` branch, checked out as a gitignored worktree at `.kanban/`. It holds `lists/<status>`, one repo-relative ticket path per line, plus the app and its `columns` file. That branch shares no history with `main`, so reordering never appears in `main`'s log.

Setup, once per machine:

```
git fetch origin kanban
git worktree add .kanban kanban
```

(Before the branch is on origin, the first machine creates it with `git worktree add --orphan -b kanban .kanban`.)

Run `npm run board`.

- Arrows (or `hjkl`) move the cursor; `g`/`G` and PgUp/PgDn jump.
- Enter shows the ticket; Enter or Esc returns.
- Space grabs a card; arrows carry it within or across columns; space drops it, Esc cancels.
- `p` toggles the parked columns (a carried card goes with it).
- `e` edits in `$VISUAL`/`$EDITOR`, `n` creates a ticket at the top of the current column, `r` reloads, `q` quits.

Each drop commits `lists/` on `kanban` and pushes it. While open, the board fetches every 15 s (`KANBAN_POLL` seconds) and rebases onto other machines' moves. A move's status change edits the ticket on `main` and stays uncommitted until the work is committed. Until then, other machines show that ticket at the top of its old column.

`npm run board -- --print [status…]` prints the board as text.
