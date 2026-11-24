---
status: inbox
created: 2026-11-02
---
# Rust arithmetic on untyped operands defaults to 0

  **Problem:** Rust reads untyped operands with .as\_i64().unwrap\_or(0), so a non-number silently becomes 0 before as sees a value. (a + b) as Integer with a

  Text operand should give a number instead of failing.

‌

  **Status:** read from the generated code, not run. Confirm the behaviour on all three targets first.

‌

  **Done when:**

- Arithmetic on a wrong-typed untyped operand fails the same way on JS, Rust and Erlang.

- Rust never substitutes 0 for an operand.

- Tests cover Text, Boolean and null operands, and a Float operand so it doesn't get truncated by the i64 read.
