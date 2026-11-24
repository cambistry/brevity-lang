---
name: reference_auto_memory_sync
description: Project memory lives in the repo's memory/ dir; the per-machine auto-memory dir only points here
metadata:
  type: reference
---
Claude Code's `autoMemoryDirectory` is user-level only, with no path templating, so per-project memory can't follow a repo through configuration.

This project's memory therefore lives in the repo, in `memory/` (index `memory/MEMORY.md`, loaded through `CLAUDE.md`). The machine-local auto-memory `MEMORY.md` (`~/.claude/projects/<encoded path>/memory/`) holds only a pointer here.

**How to apply:**
- Write every new memory, and every update, to `memory/` in the repo, with its pointer line in `memory/MEMORY.md`. Never to the machine-local directory.
- On a new machine, the local `MEMORY.md` needs the same pointer; nothing else.

**Background.** `autoMemoryDirectory` is blocked from `.claude/settings.json` and `.claude/settings.local.json` for security (a cloned repo can't redirect memory writes); it's set only in `~/.claude/settings.json` or with `--settings`. The options were: symlink the machine-local memory dir to a repo dir (per machine, since the encoded path differs); move shared content into the repo (chosen, as this `memory/` plus `CLAUDE.md`); or wait for a Binder-style commentary channel. The canonical failure that motivated it: a session loaded memory from 2026-03-30 about `*` that another workstation had already superseded with `Type!`.
