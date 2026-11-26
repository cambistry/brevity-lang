---
created: 2026-11-02
---
# Fix: null as List from a remote passes on JS

**Problem:** null is JS's empty list, so _bvAs accepts a null reply as a List. Rust and Erlang fail it. A literal null as List is already a compile error on all three.

**To decide:** should JS tell a wire null from an empty list when it checks the reply, or should the empty list get a different runtime form?

**Done when:**

- A remote null fails as List and as List of T on all three targets.
- A remote [] passes on all three.
- as List | null passes for both.
