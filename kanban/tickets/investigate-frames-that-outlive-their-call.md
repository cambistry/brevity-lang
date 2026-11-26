---
status: investigation
created: 2026-11-23
---
# Investigate: frames that outlive their call

Design: notes/escaping-frames-2026-11-23.md (proposal)

Today: a function that returns a live element, e.g. `Clicker = { count *Integer = 0; <div onclick={ count <- count + 1 }>{ count }</div> }`, leaves cells and closures that the element still subscribes to after the call returns.

Find and report (no changes yet):

- What happens today on each target when such a function is compiled and called: whether it compiles, where `count` and the closures live, and what addresses the element is given.
- How Layer A assigns closure addresses (`@0`, `@1` by source position) and what would have to change to give each call a fresh frame address. Propose a wire shape for the frame address and how parents translate it.
- Whether the declaring actor can host per-call frames as children with the existing child and translation machinery, or what's missing.
- What release on last unsubscribe would take: whether subscription bookkeeping exists to detect "no subscribers left", per target. Also whether a frame's own outgoing subscriptions can be torn down.
- Whether a frame address can leak through a plain message (not a subscription), and what that means for safe release.

Output: per-target findings, a proposed frame address shape, and a sketch of the release mechanism with its gaps.
