---
name: compiler
description: Rules for changing the compiler — no silent acceptance, no detectors for non-forms, no migration wording, refusals are often gaps
metadata:
  type: feedback
---

- **No silent acceptance.** Unrecognised input throws where it's met. Never consume, skip, or discard tokens or characters a branch doesn't use. Removing detectors on 2026-11-19 exposed many accept-anything paths: a lexer skipping unknown characters, `else { consume(); }`, a parse-and-discard `} : Type`, and no name resolution at all.
- **Fix the general path, not the input.** For a bad-input bug, ask what else that path accepts. If removing a check makes a form compile, dump its tokens and AST to see what it became.
- **No detectors for non-forms.** Brevity is unreleased and has no users. Abandoned or foreign syntax (`**{`, `Self`, `$x`, `|` subclassing…) fails as an ordinary parse or resolve error, like a typo. Delete such checks, but keep the test that the form fails, asserting only that it errors. Specific diagnostics are only for real forms misused.
- **No migration wording ever** in errors, comments or docs ("retired", "no longer", "deprecated", "now", "instead"). History belongs in notes/.
- **A refusal is often a gap.** "Can't X yet" in the transpiler isn't a language rule. Check its comment and the notes, reason from uniform semantics (closures and classes both message their enclosing scope), and credit the runtime plumbing that already exists when scoping.
- **AST field names** (`initBody`, `constructorBody`, …) are structural names. Don't rename them to match the user-facing vocabulary.
