---
name: feedback_no_migration_language
description: Brevity is unreleased with no users — no special-case diagnostics for abandoned/foreign forms; let them fail as ordinary parse/resolve errors
metadata:
  node_type: memory
  type: feedback
  originSessionId: e8c1b902-8c27-44ed-aa79-c8d08b6460af
  modified: 2026-11-19T16:19:47.468Z
---

Brevity has never been released and has no users. So there is no "old syntax" to recognise. A form the language doesn't have (an abandoned design like `**{`, `Self`, `$x`, `*(params) {`, prefix-colon params, `|` subclassing) is just tokens that don't parse, or a name that doesn't resolve, the same as a typo like `Thnig`.

The rule: **don't write detectors for forms that aren't in the language.** Delete them, and let the parser or resolver report the failure at the level where it naturally happens ("unexpected token", "unknown name"). Rewording such a detector is not enough. Even "'**{' is not valid — an actor literal is…" assumes `**` was meant to mean something, and "'$' … state is declared with '*Type'" ties a stray symbol to state. Both are wrong.

**Why:** Nobody has old code to migrate. Special cases preserve design churn in the compiler, make guesses about intent, and add code for nothing.

**How to apply:** When an error check exists only because a form used to be (or might once have been) valid, remove the check. Keep the test that the form fails (never drop tests), but assert only that it errors, or assert the generic message. Specific diagnostics are fine for forms that ARE in the language and are misused in context, judged on present-day grammar alone. Never use migration wording ("retired", "no longer", "deprecated", "now", "instead", "the new form"). Design history belongs in notes/.
