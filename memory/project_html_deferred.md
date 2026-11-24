---
name: HTML deferred work
description: Deferred — Brevity-source `node <- "x"` on a remote-bound local doesn't route to the runtime's text-node bare-set
metadata:
  type: project
---
**Shipped 2026-04-26:** text-node bare set (wire `{op: [[v], '$set'], to: <node addr>}` with no field selector writes `node.nodeValue`; Element/Document ignore it; `registerNonElementNodeActor` in `src/codegen/browser/runtime.js`), and Aria/ClassList/Dataset sub-rep dedup via `getOrMintSubRep`.

**Still deferred (checked 2026-11-24):** Brevity source `node <- "x"` doesn't reach that runtime path when `node` is a wire token from a remote call (`node = el.first_child()`). The `ActorSetStatement` branch in `src/codegen/javascript/statements.js` always emits `target.receive(...)` against the JS variable: fine for child-actor vars, throws for wire-token strings. `ActorFieldSet` just above it has a remote branch (`ctx.depSource` + `this.#binding.post`); `ActorSetStatement` has none.

**Why:** the user scoped it out so traversal/identity work could ship; runtime-only works through raw CAM messages.

**How to apply:** pick up when source-level bare-set on remote nodes becomes load-bearing; mirror the `ActorFieldSet` remote branch. The validator may also want a typed "object-level set" surface in the manifest to declare which types accept bare assignment.
