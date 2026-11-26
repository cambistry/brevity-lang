---
created: 2026-11-18
---
# Dependencies are addressed by their source

Summary

A dependency's wire address is its source, never its local name. Today `use Svc = "svc.bv"` sends `to: "Svc"`; it must send `to: "svc.bv"`. The local name is a lexical binding only. This hasn't shown up so far because the browser's services are bound under their own names (`use HTML`), and the tests for aliased paths only check `to`, so they pinned the bug.

Semantics

- `to` (and any address embedded in a payload) is the dependency's source: `use Svc = "svc.bv"` → `svc.bv`, `use HTML` → `HTML`, `use :div = "/dom"` → `/dom`, `use("/file/path")` → `/file/path`.
- An address is an Opre token: a source containing `:` (or starting with `'`) goes on the wire single-quoted, with `''` for a quote inside it (`'bluster://n1'`), as in src/codegen/opre_tokens.js.
- Renaming a binding never changes the wire. Two bindings of one source are one address.
- Replies and inbound `from` are matched against the same address.
- Unchanged: `ty` tags reached through a dependency (already the source), `from`, and the manifest (already keyed by source).

Work

- One name → address map per compile, built from `ast.dependencies`, applied at every codegen site that builds a dependency address on js, rust, erlang and browser: calls, silent sends, subscriptions, destructured members, `$new` targets (constructor profiles and coercions), element-factory hosts for XML tags, and a dependency passed as a value.
- Opre-quote the source when it needs it.
- Tests: update the assertions that expect a local name in `to`; add aliased path, `::` member, constructor and quoted-source (`:` in the source) cases on all three targets.
- A dependency passed as a value (`Peer.take(Svc)`) goes on the wire as its address, `#<source>`, as `Self` does; today every target emits a bare identifier.
- Type registries: drop the alias spellings (`Svc:Point` beside `svc.bv:Point`), or keep them with a stated reason, once `to` carries the source.
- Browser runtime: split a destination's head token with the Opre splitter (it uses `indexOf(':')`), so a quoted source works.
- Retire the hidden `__use_*` entry names on the wire: an entry's internal key never reaches an address.
