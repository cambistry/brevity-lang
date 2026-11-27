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
- **Tickets go on branches, in worktrees** ([ticket_worktrees](ticket_worktrees.md)). Other work stays on `main`: don't branch it. Never push unasked.

## Keep working
- Work until the task is done or a real blocker needs the user. The user decides session length and stopping points.
- No mid-task check-ins or progress summaries, and no "want me to keep going?". After a sub-step, go straight to the next.
- No throttling: never offer `/schedule`, propose wrapping up, shrink scope to finish sooner, or defer work that could happen now. Reduced output dressed up as care damages trust.
- The commit and test gates above still apply.

## Tickets and pasteables
- Tickets are `kanban/tickets/<slug>.md`; ones in Review, Done or Won't Do are in `kanban/finished/` (format and columns in `kanban/README.md`). A ticket's column lives only in `.kanban/lists/`. When something should be a ticket, file it myself: write the file in `kanban/tickets/` (the board puts it at the top of Inbox) and say so in one line. Never hand over a draft to paste.
- Status moves with the work: In Progress when I start, Review as soon as I judge it done and the suite is green. Moving to Review means `git mv` of the ticket to `kanban/finished/`, and that move goes in the commit of the ticket's work, so it says "done" when the branch lands on `main`. Then move its list line as below. Done and Won't Do are the user's calls.
- **Queued** (after To Do) is the user's work queue, in order. Take tickets from its top.
- **Working the queue:** while Queued holds tickets, each ticket is: done to my satisfaction and full green > move it to `finished/` and commit it with the work > land the branch > move its line to Review > resume any unblocked ticket, else move the next queued ticket to In Progress > repeat. A ticket blocked on the user is parked, not waited on ([ticket_worktrees](ticket_worktrees.md)). That is standing authorization to commit each one. Always do it carefully: a ticket's design questions go to the user, and the answers into the ticket, before its code.
- **Starting a ticket:** move its line out of its current `.kanban/lists/<status>` file to the bottom of `.kanban/lists/in-progress`. Then, in `.kanban`, commit (message `order`), `git pull --rebase` and `git push origin kanban`, so other workstations see the move. Auto mode's safety check refuses a push unless the exact command matches an allow rule in `.claude/settings.local.json`. So run `cd .kanban`, the pull and the push as three separate Bash calls, with that exact text: never chained, never `git -C`. If the pull says "Cannot rebase onto multiple branches", the board app fetched at the same moment; run it again before pushing, never push past it. After pushing, check `origin/kanban` holds the move: an open board app can write its older lists back over it. Moving to `review` works the same way: the line goes to the bottom of `.kanban/lists/review`, as `kanban/finished/<slug>.md`. These two pushes are standing-authorized; nothing else on `kanban` is.
- Order is the user's. Apart from that move, never edit `.kanban/lists/` unless asked. Read the board with `npm run board -- --print [status…]`.
- Pasteable text (messages, commit text) goes in a fenced code block, never `>` lines, because the markers come along on copy.

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
