---
name: Subscription via multi-response `re`
description: How reactive subscription works in Brevity — subscribe is a regular CAM op with multi-response correlation, not a special language primitive
type: project
originSessionId: 0ad23c2f-93a4-4d51-8932-0363758b5e8a
---
Design state pinned 2026-04-18. Full note: `notes/subscription-via-multi-re-2026-04-18.md`.

**Core:** `subscribe` is not a special op. It is a regular CAM op where the callee keeps replying — same correlation `id`, multiple `re` messages over time. No new wire verb, no semantic notification verb (`set`/`change`/`updated`) — the wire carries values, not meanings.

**Why:** User had been looking for the right notification verb (`set`? `change`? `updated`?). The resolution was to drop the verb question entirely: subscription is just a long-lived continuation keyed by the message id. Generalizes to *streaming ops* — any op can send multiple `re` over time (progress, iteration, events).

**How to apply:**
- Surface syntax: `c.x.subscribe |val| { ... }` — literal `.subscribe` method call, not a reserved keyword. Built-in cells and closures implement the protocol; user types opt in.
- Wire: `{ id, op: "subscribe", to: <addr> }` → repeated `{ id, re: <value> }` using the same id. First `re` is the initial value (no separate "current value" op). Unsubscribe = id cancellation (protocol-level, no keyword).
- Interface shape for public reactive cells: `x: Integer!` — postfix `!` (the actor-ref sigil) implies the full reactive protocol (get/set/subscribe), replacing the getter+setter pair form. (Originally written as `*Integer` prefix; updated to match the post-2026-04-25 sigil convention.)
- Closure interface shape: not settled yet.
- When designing any streaming/progressive/observable pattern in Brevity, reach for multi-response `re` before inventing a new primitive.

**Related system-op vocabulary:** bare words `new`, `set`, `update` for CAM system ops (replaced earlier `::`-prefixed form). `subscribe` joins that vocabulary but is method-called, not protocol-prefixed.
