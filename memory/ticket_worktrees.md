---
name: ticket_worktrees
description: Every ticket gets a branch in its own worktree; a blocked ticket is parked there and the queue moves on
metadata:
  type: feedback
---

Every ticket I start is worked on its own branch, in a worktree under `.worktrees/`. The main checkout stays on `main` for the user's design and workflow sessions: I never switch it off `main` or edit it for ticket work. Non-ticket work (notes, memory, a quick fix asked in chat) stays on `main` as before.

**Why:** tickets sometimes need the user while they're away or asleep. A parked branch lets the queue move on without a question blocking the session, and a separate worktree keeps ticket work out of the tree the user's other sessions use.

## Starting a ticket
- From the main checkout: `git worktree add .worktrees/<slug> -b t/<slug> main`.
- Link the shared caches into it: `ln -s ../../node_modules .worktrees/<slug>/node_modules` and `ln -s ../../../rust/cache .worktrees/<slug>/rust/cache`. The cache is keyed by a hash of the generated Rust, so sharing it is safe.
- Clone the cargo workspaces, don't link them: `cp -cR rust/w* .worktrees/<slug>/rust/` (APFS copy-on-write: instant, no disk until written). They hold the compiled dependencies, so the worktree skips a dependency build per worker. A clone shares no mutable state, so even an accidental parallel run can't poison another tree.
- Entries built in a worktree record its test paths, so removing the worktree makes the sweep drop them, and `main` rebuilds those tests after landing. Expected; not a fault. If Rust results are inexplicable, suspect the shared cache and ask.
- Copy the main checkout's `rust/src/main.rs` into the worktree's `rust/src/` (it's gitignored). Without it, cargo in `rust/w*` fails to parse the parent `rust/Cargo.toml` ("no targets specified").
- Work, test and commit inside `.worktrees/<slug>`. Name it in every command (`cd .worktrees/<slug> && …`) rather than trusting a carried `cd`.
- Board moves happen as before, in `.kanban` from the main checkout ([workflow](workflow.md)).

## Blocked
A real question for the user, which a sensible default can't settle:
1. Add a `## Blocked` section to the ticket on the branch: the question, the options and my leaning, what's done, what's next. It must be enough to resume from cold, since my memory of the ticket won't survive compaction.
2. Commit on `t/<slug>` with the message `WIP: <slug>`. Standing-authorized, branch only. Never stash: stashes are shared across worktrees and invisible on the board.
3. Ask in chat, naming the slug, and send a push notification.
4. Leave its board line in In Progress, and start the next Queued ticket in a new worktree.

Never wait at a prompt while working the queue. Ask and move on.

## Unblocked
- When the user answers, write the answer into the ticket in place of `## Blocked`, as a decision.
- Finish the active ticket first (one ticket at a time). Then resume the unblocked one, before any new Queued ticket.

## Landing
1. In the worktree: `git rebase main`, then full green ([testing](testing.md)) on the rebased branch. The ticket's `git mv` to `kanban/finished/` is in the branch's final commit.
2. Squash the `WIP:` commits into the ticket's commit, so `main` gets one commit per ticket.
3. From the main checkout: `git merge --ff-only t/<slug>`. If git refuses because the user's uncommitted edits overlap, leave it ready and say so. Never stash or touch their edits.
4. `git worktree remove .worktrees/<slug>`, `git branch -d t/<slug>`, then move the board line to Review.

## Limits
- One test process at a time across all worktrees, the main checkout included.
- Never push `t/*` branches unasked.
