---
status: done
created: 2026-11-20
---
# Lambda arrow body can't be an `if` expression (js codegen)

`g = (n Integer) -> if n == 0 { 0 } else { g(n - 1) }` fails to compile on

  js with "Unknown expression type: IfExpr". The braced form

  `g = (n Integer) { if n == 0 { return 0 }; return g(n - 1) }` works.

  Check rust and erlang too; add the arrow form to a lambda test on every target.
