---
status: inbox
created: 2026-11-02
---
# Fix: as doesn't check class types, function types or undeclared names

**Problem:** x as Session, f as (Integer) -> Integer and as on a name the file doesn't declare only relabel, so the value is never checked. A class-typed as can't check for an address yet, because instance references differ by target: an address string, a JS handle, a Rust instance id or an Erlang pid.

**To decide:**

- What counts as a valid actor reference, across all targets?
- Should a function type check anything beyond "is a reference"?
- Should as on a name with no known shape stay a label, or become a compile error?

**Done when:**

- Each decided case renders or fails the same way on JS, Rust and Erlang.
- notes/session-2026-11-01-as-renders-or-fails.md is updated.
