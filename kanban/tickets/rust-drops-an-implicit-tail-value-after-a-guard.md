---
created: 2026-11-02
---
# Fix: Rust drops an implicit tail value after a guard

Problem: if b { return "x" }; 9 in a file handler replies [] on Rust when the guard doesn't fire. JS and Erlang reply [9]. The handler only emits its tail when it has no guards (src/codegen/rust/handlers.js:263).

Done when:

- The tail value is the reply on all three targets, in a file handler and in a class.
- It works with one guard and with several, and with a call as the tail value.
- The guard's own path still replies with its value and tag.
- Tests are in __tests__/functions/return_shapes.test.js.
