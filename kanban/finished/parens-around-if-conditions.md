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

**Decided (2026-11-26):** an `if`'s condition ends at a `)` closing a group that opens it, at a
`{`, or at the end of the line. Nothing else ends it, so a same-line branch without a block
needs the paren group.

```brevity
if (bool) n <- 1                      // ok: )
if bool { n <- 1 }                    // ok: {
if a > 10                             // ok: end of line
  n <- 1
if row == last { 0 } else { row + 1 } // ok: {
x = if (row == last) 0 else row + 1   // ok: )
if (a > 10) return "big"              // ok: )
if (c) (a - b) else 0                 // ok: the group ends the condition; not a call

if bool n <- 1                        // error: no end
if a > 10 return "big"                // error: `return` doesn't end it
if (a + b) * 2 > c 1 else 0           // error: the group ends at (a + b)
```

- Parens around a condition that a `{` or a line break ends are style, never required.
- `repeat while` ends at its `{`: unaffected.
- **An early return is `if (c) return v`,** with `else return v`. There is no `->` branch:
  `if (c) -> v` was an artifact of `->` meaning `return` (follow-up:
  `if-arrow-branch-is-not-a-return`).
- **Computed clause heads:** not implemented; not this ticket.
