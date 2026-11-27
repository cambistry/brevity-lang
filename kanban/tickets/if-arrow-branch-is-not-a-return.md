---
created: 2026-11-26
---
# `if (c) -> v` never parses as `if (c) return v`

An early return is `if (c) return v` / `else return v` (parens-around-if-conditions). `-> v`
after an `if` was an artifact of `->` meaning `return`. It is the `-> expr` form, not a
return, and that form is going (it will need `() -> …`).

Check every place an `if` branch is parsed (expression `if`, function-body and while-body
statement `if`, constructor blocks, clause bodies, the inline `if c n <- v` form) and every
place `->` is read as a return. No path may turn `if (a > 10) -> "big"` into
`if (a > 10) return "big"`. Add a test per path that it doesn't.

The reverse also needs checking. In an `if` used as a value (`x = if (c) return 1 else 2`),
the parser's `settleWrites` (`lone` in src/parser.js) still reads a lone `return` branch as
the branch's value, as it read the old `->` branch. A `return` there should leave the
function, or be an error, never become the `if`'s value.
