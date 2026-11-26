---
status: inbox
created: 2026-11-02
---
# Fix: on Rust, `r = b.get()` with a named reply binds null

- **Problem:** JS and Erlang fail with error, while Rust replies { r: null }.

- **Done when:** Rust takes the sole positional and fails otherwise, as the as note already says it should for x = f().

- **Independent:** this is in the handler bind path, so it doesn't depend on the other two.
