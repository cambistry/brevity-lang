---
created: 2026-11-25
---
# Parens around `if` conditions: when required

Today: `if (cond) …` is always allowed, and parses (a parenthesized expression).

Decide: where it is required.

The problem is the inline value form, where nothing separates the condition from the value: `if row == last 0 else row + 1`, or `if col < left col else if col >= left + count col - count + 1 else left`. The block form already has a separator, since `{` ends the condition.

Positions:

- **Inline value `if`:** required (`row <- if (row == last) 0 else row + 1`). Ruby makes the same split: a one-line `if` needs `then`.
- **Block `if`:** optional (`if row == last { … }` and `if (row == last) { … }` both legal).
- **`repeat while`:** its block ends the condition at `{`, so optional.
- **Computed clause heads** (`(x == 1) -> …`, `notes/clause-lists-2026-11-25.md`): required, for the same reason.

A required paren group is the whole condition: `if (a + b) * 2 > c x else y` stops at `(a + b)` and fails, instead of reading ambiguously.
