---
status: done
created: 2026-11-02
---
# Rebinding a name inside a branch returns the old value

  Problem: r = 5; if c { r = b.one(); return r } replies [5] on JS and Erlang, and [1] on Rust. I only ran this with an instance call, so a plain r = 2 may

  do the same.

‌

  Done when:

- The branch returns the rebound value on JS, Rust and Erlang, with a plain value and with an instance call.

- The path that skips the branch still returns [5].

- Tests cover both paths.
