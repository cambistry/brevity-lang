# Kanban

One file per ticket. The folder is the column; moving a ticket is `git mv`.

- `backlog/` — not started
- `doing/` — in progress (normally one)
- `done/` — finished, awaiting clear-out

File name: `kebab-case-slug.md`. Contents:

```
# Title

Description: the problem, the expected behaviour, and any pointers
(tests, notes/, source files).
```

Tickets are work items only. Design reasoning goes in `notes/`; a ticket links to the note.
