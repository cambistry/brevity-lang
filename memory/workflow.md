---
name: workflow
description: Commits, branching, tickets, pasteable text, notes/ discipline, memory location, lint, user style
metadata:
  type: feedback
---

## Commits and git
- **Never commit unless told to.** An earlier "commit" covers only that moment's work. "Proceed" after a review is not a commit signal.
- **"Commit" means commit now.** No tests or lint first; the user runs them. Look at the diff only to write the message.
- **Normal flow:** finish, full green ([testing](testing.md)), report, wait for acceptance.
- **Self-supervised run** (the user queued several tickets and said I'm self-supervising): per ticket, green > commit > next.
- **One ticket at a time, always,** even when tickets arrive together ("1. … 2. …"). Ticket 1 green > commit (if allowed) > only then ticket 2. Never stack two tickets in one tree.
- **On the default branch, don't auto-branch.** Surface branch-vs-main in one line, and default to committing where we are. Never push unasked.

## Keep working
- Work until the task is done or a real blocker needs the user. The user decides session length and stopping points.
- No mid-task check-ins or progress summaries, and no "want me to keep going?". After a sub-step, go straight to the next.
- No throttling: never offer `/schedule`, propose wrapping up, shrink scope to finish sooner, or defer work that could happen now. Reduced output dressed up as care damages trust.
- The commit and test gates above still apply.

## Tickets and pasteables
- Tickets live in `kanban/` (one file per ticket; the folder is the column; see `kanban/README.md`). When something should be a ticket, write the file in `kanban/backlog/` and say so in one line. Move a ticket to `doing/` when starting it and to `done/` when it's green.
- Pasteable text (tickets, messages, commit text) goes in a fenced code block, never `>` lines, because the markers come along on copy.

## notes/ and memory
- Design state goes in `notes/` as dated `topic-YYYY-MM-DD.md`. Memory holds pointers and working rules, never design content.
- `notes/` is design only: options, decision, reasons, open questions. Never git state, task status, to-dos or session narration. Report progress in chat.
- Memory lives in this repo's `memory/` (loaded via `CLAUDE.md` → `memory/MEMORY.md`). Write and update here only. The machine-local auto-memory `MEMORY.md` is one pointer line to this index, and on a new machine it needs only that line. (`autoMemoryDirectory` can't be set per repo; local memory once went stale across workstations.)
- Keep `MEMORY.md` an index of files. Add rules to the topic file they belong in, not as new index lines.

## Lint
- Own every lint error the user reports. Fix it; never argue about where it came from.

## User
- Prefers terse, precise writing. "First pass" means substantive, not exhaustive.
- Tensile is a separate CLI for Brevity with an HTML UI. It catches problems tests miss, and it is not in this repo.
