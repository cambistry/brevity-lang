---
status: inbox
created: 2026-11-25
---
# `and`, `or`, `not`, and unary minus

None exists today: `a and b` fails with "Expected a line break or ';' after a statement, got IDENT 'and'", and `n = -1` with "Unexpected token in expression: MINUS '-'". Writing `kanban/board.bv` needed nested `if`s for every combined condition and `0 - 1` for every negative.

- `and`, `or`, `not` as keywords on Booleans, short-circuiting. Decide their precedence against comparison and arithmetic, and whether `not` binds tighter than `==`.
- Unary minus on numbers: `-1`, `-PAGE`, `-(a + b)`. At the start of a line inside multi-line brackets, a `-` begins a new item, not a subtraction from the line before (ticket `line-breaks-separate-items-in-multi-line-brackets`).
- `and`/`or`/`not` are currently ordinary names; reserving them breaks any code using them as names.
