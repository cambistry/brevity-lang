---
name: Design state goes in notes/, not private memory
description: Repo-visible design/planning docs belong in notes/; private auto-memory should only hold pointers to them.
type: feedback
originSessionId: 43a88a5f-a155-4936-bcf7-653d41e4d22c
---
Design state, planning docs, and conversation outcomes that describe language/system direction belong in `notes/` (repo-visible) — not in the private auto-memory directory. Private memory should hold at most a **pointer** to the relevant notes file, plus short feedback/user/reference entries that don't make sense to version in the repo.

**Why:** Chris couldn't see a design-state file I'd written into private memory (`~/.claude/projects/.../memory/`) because that directory isn't part of the repo. He explicitly said "I prefer things in notes/." Design decisions need to be readable, reviewable, and co-located with the code they describe — private memory is opaque to him and disconnected from git history. **Additional reason surfaced 2026-05-06:** private memory is per-workstation and cannot be synced via settings (see `reference_auto_memory_sync.md`). Content-in-memory therefore goes stale across stations — e.g., the `*Type` actor-ref sigil note from 2026-03-30 lingered locally after being superseded by `Type!` on another machine, and I confidently parroted it before checking. Pointer-only memory + content-in-`notes/` makes the supersession story authoritative wherever the repo is checked out.

**How to apply:**
- When capturing design state, planning outcomes, or feature-design conversations → write a dated note in `notes/` (convention: `topic-YYYY-MM-DD.md`).
- In private memory, either: (a) leave a `type: reference` pointer memory naming the note file(s) and a one-line hook, or (b) skip the memory entirely if the note is self-contained and discoverable.
- Do **not** duplicate substantive design content into private memory. Pointer-plus-notes beats two copies that drift.
- Feedback, user profile, external-system references, and cross-conversation process guidance (this file, the Rust cache gotcha, etc.) still belong in private memory — they're not project artifacts and don't want repo noise.
- Applies retroactively: if you find substantive design content already living in private memory, move it to `notes/` and shrink the memory entry to a pointer.
