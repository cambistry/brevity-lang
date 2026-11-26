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

### Bugs and features

A **bug** is behaviour that is wrong: silent acceptance, a wrong reply, a crash, a leaked internal name, a misleading error. A clean refusal of something designed but unbuilt ("not supported yet") is a feature, not a bug.

- A bug's title starts with `Fix:` and states the problem (`Fix: \`over\` accepts an Integer as the list`) or the fix with "should" (`Fix: a typed local should refuse an unrelated class`).
- Other titles keep their prefix (`Investigate:`, `Design:`, `Explore:`, `Q:`). A title must not read as a description of current behaviour when it names a desire: `A type should be able to extend a type`, not `A type extends a type`.

Every sentence in a body is labelled as either current state or desired state:

- Bugs: `Problem:` (what happens today) and `Expected:` (what should happen).
- Features: `Today:` (what exists or happens now) and `Want:` (what should exist).
- A label heads its paragraph or list and covers all of it. Context, repros, pointers and task lists (`Decide:`, `Find:`, `Done when:`) may stand unlabelled, as long as they don't make a claim about what happens or should happen.

```
# Fix: `over` accepts an Integer as the list

Problem: both compile, with no form behind them:

    (code)

Expected: a non-list fails where it's met.
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

- Arrows (or `hjkl`) move the cursor; up/down wrap around a column, left/right stop at the ends; `g`/`G` and PgUp/PgDn jump.
- Columns are 40–50 characters wide, as many as fit (two hold, narrower, down to a 45-wide screen), refitting on resize; moving past the edge scrolls them (`‹`/`›` mark hidden ones). A column's header shows its count; the cursor's column shows the position too, as `Inbox 3 / 16`.
- Enter shows the ticket, with its column as status; arrows walk to the neighbouring tickets as on the board, PgUp/PgDn scroll, `d` deletes it (after a y/n confirm) and shows the card now in its place, or the column's last; Enter or Esc returns.
- Space grabs a card; arrows carry it within or across columns; space drops it, Esc cancels.
- `e` edits the ticket body (front-matter stays out of the editor) in `$VISUAL`/`$EDITOR`, `n` creates a ticket at the top of the current column, `r` reloads, `q` quits.

Each drop commits `lists/` on `kanban` and pushes it. While open, the board fetches every 15 s (`KANBAN_POLL` seconds) and rebases onto other machines' moves. The lists decide the columns: a move shows on other machines as soon as `kanban` syncs. It also edits the ticket's `status` on `main`, which stays uncommitted until the work is committed; the quick-view flags a ticket whose front-matter lags its column. The board watches `kanban/tickets/`: a ticket added on disk (or present at startup) that no list holds goes by its front-matter, at the top, and is recorded there in `lists/`.

`npm run board -- --print [status…]` prints the board as text.
