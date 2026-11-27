---
created: 2026-11-25
---
# `and`, `or`, `not`, and unary minus

Today: none exists: `a and b` fails with "Expected a line break or ';' after a statement, got IDENT 'and'", and `n = -1` with "Unexpected token in expression: MINUS '-'". Writing `kanban/board.bv` needed nested `if`s for every combined condition and `0 - 1` for every negative. `and`/`or`/`not` are ordinary names; reserving them breaks any code using them as names.

Want:

- `and`, `or`, `not` as keywords on Booleans, short-circuiting. Decide their precedence against comparison and arithmetic, and whether `not` binds tighter than `==`.
- Unary minus on numbers: `-1`, `-PAGE`, `-(a + b)`. At the start of a line inside multi-line brackets, a `-` begins a new item, not a subtraction from the line before (ticket `line-breaks-separate-items-in-multi-line-brackets`).

**Decided (2026-11-26):**

- Precedence, tightest first: `^` (power); unary `-` (`-2 ^ 2` is `-(2 ^ 2)`); `* / %`; `+ -`; comparisons; `??`; `not` (`not a == b` is `not (a == b)`); `and`; `or`.
- `and`, `or`, `not` take Booleans and give a Boolean; a non-Boolean operand whose type is known is a compile error. They short-circuit.
- `-` on a literal folds to a negative literal, so `-1` works wherever a literal does (defaults, literal patterns).
- A `-` at the start of a line inside multi-line brackets is `line-breaks-separate-items-in-multi-line-brackets`, not this ticket.
