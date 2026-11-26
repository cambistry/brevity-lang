---
created: 2026-11-02
---
# Fix: typed params go unchecked on public handlers with an empty body

**Problem:** src/as_check.js skips the param check when a public handler's body is empty, because a trailing check would become the reply. On JS and Erlang, a wrong value in a typed param then goes unnoticed. Rust's decode still fails, and so does JS's for Integer.

**Done when:**

- @f = (x Text) { } receiving a wrong value fails the same way on all three targets.
- The handler's reply is unchanged when the value is right.
