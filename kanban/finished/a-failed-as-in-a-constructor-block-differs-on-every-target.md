---
created: 2026-11-02
---
# A failed as in a constructor block differs on every target

Problem: when a class's constructor block has a failed as, JS fails the caller with error, Erlang ignores the failure and succeeds, and Rust's generated code doesn't build.

Done when:

- The calling handler replies ex: { "@go": "error" } on all three.
- Rust's generated code builds, and Erlang's caller doesn't hang.
- Tests cover constructing through a handler and through #new.
