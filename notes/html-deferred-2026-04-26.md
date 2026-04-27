# HTML/DOM deferred work — 2026-04-26

Originally two follow-ups from the Node/tree-traversal pass; both shipped.
A new follow-up (source-level codegen for object-targeted `<-`) was
identified while landing the runtime side and is captured below.

## ~~1. Text-node bare set~~ — shipped

Wire-form `{op: [[v], 'set'], to: '#<<text-or-comment-addr>>'}` now writes
through to `node.nodeValue` and replies self. Element + Document silently
ignore (no nodeValue meaning). Lives in `registerNonElementNodeActor`'s
dispatcher, alongside the existing `@normalize!` and read-accessor paths.

## ~~2. Aria sub-rep dedup~~ — shipped

Resolved as part of the ClassList/Dataset batch via the generic
`getOrMintSubRep(kind, el, ...)` helper backed by
`subRepsByElement: Map<Element, Map<kind, addr>>`. Aria, ClassList, and
Dataset all share the dedup pattern.

## NEW: Source-level `node <- "x"` codegen for remote-bound locals

The runtime now accepts the wire-form bare-set, but Brevity source-level
`node <- "value"` doesn't yet route to it when `node` is bound to a
wire-token returned from a remote call (e.g. `node = el.first_child()`).

Reason: `ActorSetStatement` codegen in `src/codegen/javascript/statements.js`
(~line 726) emits `target.receive(...)` against the resolved JS variable.
For child-actor vars that's a real receiver; for wire-token strings it's
not. The remote-dep branch already exists for `ActorFieldSet` (line 707
checks `ctx.dependencyNames`) but `ActorSetStatement` has no equivalent
remote routing path.

To finish end-to-end:
- Detect when the assignment target is a local bound to a remote-typed
  value (typeEnv lookup → manifest type from a remote service).
- Generate `this.#binding.post({op: [[v], 'set'], to: <token>, from: ...})`
  routed through the binding instead of `target.receive(...)`.
- Validator might also want a typed surface for "object-level set" —
  `set: (Type)` in the manifest body — to declare which types accept
  bare assignment. Today the runtime accepts it on Text/Comment by
  convention with no manifest declaration.

Pick up if Brevity-source bare-set on remote nodes becomes load-bearing.
For now, callers can compose the wire form directly when needed.
