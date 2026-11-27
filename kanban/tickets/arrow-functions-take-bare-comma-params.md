---
created: 2026-11-26
---
# Arrow functions take bare comma params

Design: `notes/clause-lists-2026-11-25.md`, "Arrow params". Split from the clause-lists work; follows `clause-lists-callable-lists-with-pattern-heads`.

Today: a function with more than one param needs parens: `add = (a, b) -> a + b`.

Want: `add = a, b -> a + b`, wherever nothing to the left owns the comma:

- Allowed right of `=`, and as a whole line in a multi-line list or clause list, which gives multi-argument patterns (`0, y -> y`).
- Parens stay required in call arguments, after `return`, and in one-line lists: `f((a, b) -> a + b)`.
- `"a", "b" -> …` takes two arguments; `"a" | "b" -> …` takes one.

**Decided (2026-11-26):** bare comma params are untyped only; a typed param needs the parens. This ticket does the names; multi-argument pattern heads (`0, y -> y`) come with `clause-lists-callable-lists-with-pattern-heads`.
