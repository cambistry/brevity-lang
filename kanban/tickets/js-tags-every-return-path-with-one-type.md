---
status: done
created: 2026-11-02
---
# JS tags every return path with one type

Problem: if c { return "x" }; return 9 replies ["x"] tagged Integer on JS. Rust and Erlang tag it Text. Tags are claims a receiver may rely on.

Done when:

- Each path carries its own tag on JS, matching Rust and Erlang.
- Tests cover paths with different types, in a file handler and in a class.
