---
created: 2026-11-02
---
# Fix: Rust arithmetic on untyped operands defaults to 0

**Problem:** Rust's untyped arithmetic (`bv_dyn_arith`, src/codegen/rust/program.js:2099) reads a non-number operand as 0: `bv_to_bigint` (:1901) and `BvDecimal::from_value` (:1932) both map anything that isn't a `Value::Number` to zero. So `(a + b) as Integer` with a Text, Boolean or null operand gives a number instead of failing. (Two Text operands under `+` concatenate.)

**Status:** read from the generated code, not run. Confirm the behaviour on all three targets first.

**Done when:**

- Arithmetic on a wrong-typed untyped operand fails the same way on JS, Rust and Erlang.
- Rust never substitutes 0 for an operand.
- Tests cover Text, Boolean and null operands, and a Float operand so it doesn't get truncated by the i64 read.
