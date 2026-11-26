---
created: 2026-11-17
---
# rust: arithmetic on two untyped call results doesn't compile

When both operands of an arithmetic operator are calls with no declared return type, the rust codegen falls back to i64 (src/codegen/rust/expressions.js, the `numOps … (lIsValue || rIsValue)` branch), even when the result is assigned to an Integer:

```
@U = (@T ++ u Integer) *{
  @uCall = {
    x Integer = @T::protFn() + class::protFn()
    return x
  }
}
```

→ error[E0308]: mismatched types — expected `BigInt`, found `i64`

```
let x__1: BigInt = ({ … outer_send(1, "~protFn", …) … }.one().as_i64().unwrap_or(0) + { … }.one().as_i64().unwrap_or(0));
```

src/inference.js (inferExprType) has no case for calls, so neither operand gets a type. With one typed operand (`f() + seed`) it works. Existing tests avoid this with `(a() + b()) as Integer` (__tests__/classes/subclasses.test.js:344, __tests__/functions/private.test.js:61). Integers are BigInt everywhere else, so the i64 path is suspect in its own right.

Possible fixes, not exclusive

- Pass the assignment's declared type (`x Integer = …`) down as the expected type of the expression.
- Infer a call's type from the function's return shape (src/return_shapes.js) when it's known.
- For unknown Value operands, use runtime dispatch (`bv_dyn_arith`, as for `Anything`) instead of i64.

Done when

- `x Integer = f() + g()` compiles and is correct on rust for own functions, outer functions (`protFn()` in a nested class) and `C::` / `class::` calls, with tests on js, rust and erlang (no target skipped).
- class_qualified.test.js's `@uCall` can go back to `x Integer = @T::protFn() + class::protFn()`.
