---
status: inbox
created: 2026-11-15
---
# Opre subops: object elements in `op`

Design: notes/opre-subops-2026-11-15.md

Want: an object in `op` is a subop, a message fragment run against the current subject. It lets a chain act on a child without moving the chain there: `a = Class(); a.val <- 100` → `op: ["$new", { op: [[100], "$set"], to: ":val", ty: [["Integer"]] }], to: "Class"`, replying with the new actor's address in one round trip. This assumes the chain semantics in notes/opre-op-chains-2026-11-15.md and bracketed arg lists from notes/op-args-always-bracketed-2026-11-15.md.

Behavior:

- `to` is required and relative to the current subject.
- Inside the subop the subject is its `to`. Its `op` is a full op sequence, so it can chain and nest.
- After the subop, the subject returns to the containing subject. A trailing subop leaves the chain's result as that subject.
- The subop carries its own `ty`; the containing `ty` skips subops.
- No `id` on the subop: silent. An `id` on it sends its own `re` to the original requester, never to the subject. Inner and outer `id`s are independent.
- A subop is part of its chain's transaction; if it fails, the whole chain rolls back.

Compiler: emit a subop for writes to, or calls on, a child of an actor just bound, where they follow it directly.

Open, in the note: delivering multiple replies to one request, their order, and how they interact with rollback.

Done when: subops run on JS, Rust and Erlang, with tests covering child `$set` after `$new`, nested subops, `ty` placement, silent and replying subops, and rollback.
