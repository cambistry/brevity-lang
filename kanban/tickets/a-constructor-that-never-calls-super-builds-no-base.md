---
status: done
created: 2026-11-20
---
# A constructor that never calls `super` builds no base

Design: notes/super-2026-11-19.md ("No base", "Without a base").

- A constructor with no `super` call on any path is legal only if the subclass defines the parent's whole public interface: every public function and public cell, by name and arity. Otherwise a compile error listing what's missing. Per parent when there are several.
- With no base, the parent's state isn't allocated, its constructor doesn't run, and its functions aren't merged.
- A parent name the subclass doesn't define, used anywhere but assignment position (calls and reads), is a compile error. So are `super`, `base::` and `base.` in the subclass's functions.
- `super` on some paths but not all stays the existing error.
- The parent's class block stays reachable (`T::x`, `T.x`).
- Tests on every target: covered interface builds and runs with no parent state; missing public function / public cell errors; protected-name use errors; `super` and `base::` errors; the subclass is still accepted where the parent is expected.
- Not in scope: signature checks beyond arity.
