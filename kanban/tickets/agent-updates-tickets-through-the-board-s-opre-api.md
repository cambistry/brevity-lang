---
status: inbox
created: 2026-11-26
---
# The agent should update tickets through the board's Opre API

Today: the agent edits `kanban/tickets/*.md` and `.kanban/lists/` by hand (`memory/workflow.md`, "Tickets and pasteables").

Want: once the board runs in Brevity (`dogfood-the-kanban-board-in-brevity`), its file actor opens an Opre API, and the agent creates tickets, edits their text, changes status and moves cards through it instead of editing files.

The agent could already work through a script without the port; the point is to exercise the board as a Brevity actor. The actor surface in `kanban/speculative/board.bv` (`@find`, `@restatus.`, `@create!`, `@place!`) sketches what such an API would expose.

Open: which operations the API exposes, how the agent reaches it (a CLI client, a running board, or both), and how moves sync between workstations.

Today: sync is git: each drop commits `lists/` on the `kanban` branch and pushes, and an open board fetches and rebases every 15 s (`kanban/README.md`).

Want (possibly): workstations' boards are actors that reach each other over Bluster, the authenticated wire (`notes/stack-and-origin-2026-11-24.md`), so a move made through the API reaches other boards as a message rather than a git round trip.

Today: Binder, the sync application on Bluster, could almost carry ticket sync between workstations already.

Want: Binder rewritten in Brevity, and ticket sync built on that version. That makes this ticket depend on two ports: the board's and Binder's.
