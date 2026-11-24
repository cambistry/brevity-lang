---
status: done
created: 2026-11-02
---
# Erlang instance processes lose the as failure message

  **Problem:** a failed as inside an Erlang instance process reports ex: { op: "error" }, without the types. The process sends {bv_error, Id}, which carries no

  message. File-level handlers on Erlang report as Integer: got Text. JS should report it inside instances, and Rust has the same handling at its instance

  dispatch, but neither has a test for this case.

‌

  **Done when:**

- A failed as in a class instance's handler gives the same ex value on JS, Rust and Erlang.

- Tests cover it on an instance that has its own process.
