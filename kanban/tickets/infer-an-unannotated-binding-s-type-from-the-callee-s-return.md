---
status: done
created: 2026-11-04
---
# Infer an unannotated binding's type from the callee's return

  x = \@‌seed(), where \@‌seed = { return 9 }, binds x as Anything, in a handler and in a constructor block. So a reply carrying x has ty: 'Anything'. When the callee has one return type (own functions, class methods, doc entries), the binding should take it. x Integer = \@‌seed() works today; see constructor_block.test.js, which annotates for this reason.
