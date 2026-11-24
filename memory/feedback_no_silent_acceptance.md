---
name: feedback_no_silent_acceptance
description: "The Brevity compiler had many \"accept anything\" paths hidden behind special-case detectors — never skip/discard input; fix the general path, not the case"
metadata:
  node_type: memory
  type: feedback
  originSessionId: e8c1b902-8c27-44ed-aa79-c8d08b6460af
  modified: 2026-11-19T17:49:16.976Z
---

When the parser or lexer meets something it doesn't recognise, it must stop with an error. It must never skip it, drop it, or parse it and throw it away. Special-case detectors and per-input tests had been hiding this. Removing the detectors (2026-11-19) exposed the general paths underneath:
- the lexer skipped unknown characters (`i++`);
- the file-level loop did `else { consume(); }`;
- reply fields and statements needed no separator;
- `} : Type` after a braced body was parsed and discarded;
- builtin calls matched method names with `!` stripped;
- `parseInterface` never parsed types;
- there is no name resolution at all (`@f = -> Thnig` compiles on every target).

**Why:** Each detector made one known bad input give a good-looking error, and its test passed. That looked like rigor, but it only proved rejection of the inputs someone had thought of. The user was shocked at what it revealed about the compiler's safety.

**How to apply:**
- Never write a branch that consumes, skips, or discards tokens or characters it doesn't use. Unrecognised input throws at the level where it's met.
- When fixing a bad-input bug, find the general path that let it through and fix that, not the one input. Ask "what else does this path accept?"
- If removing a check makes a form compile, investigate what it compiled to (dump tokens and AST). Don't assume it's fine.
- Tests should state rules ("any character with no token is an error"), not lists of specific bad spellings with tailored messages.
- Related: [[feedback_no_migration_language]] (don't detect non-forms; let the general path fail). That only works if the general path does fail.
