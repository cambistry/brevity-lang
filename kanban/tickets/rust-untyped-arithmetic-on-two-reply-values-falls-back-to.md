---
status: done
created: 2026-11-20
---
# rust: untyped arithmetic on two reply Values falls back to i64

`return f() + g()` (no declared type anywhere) still takes the i64 path in

  src/codegen/rust/expressions.js (`numOps … (lIsValue || rIsValue)`), so it

  truncates BigInt results and differs from every other Integer path. Either

  infer a call's type from its function's return shape (src/return_shapes.js),

  or dispatch at runtime (bv_dyn_arith, as for `Anything`) and let consumers

  convert. Test on js, rust and erlang with a result above i64 range.
