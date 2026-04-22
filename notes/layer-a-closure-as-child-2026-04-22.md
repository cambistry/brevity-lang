# Layer A — closure-as-child on the wire (2026-04-22)

Plan for the next epic step after the CAM wire-format refactor. Implements
`notes/big-factory-example-2026-04-21.md` Layer A: closures in template
expressions become first-class addressable entities, their addresses travel
in payload slots as `<<…>>` strings, and the transport layer translates
them to tree-global form on hop.

Escape convention (`\<<…>>` as literal) is **deferred**. Nothing in Layer
A's test surface carries stringified wire samples in payload, so the
hazard escape protects against is absent. Escape lands when embedded-wire
payloads become a real use case.

## Five phases, each its own commit

### Phase 1 — Closure primitive

Brevity source binds closures to names; the compiler allocates each
closure a numeric wire-address (`@0`, `@1`, …) by source-position walk
per actor. Captured refs trigger replay on change. Same machinery as
the 2026-04-20 fn-subscribe landing — new surface is (a) numeric
address allocation for anonymous closures, (b) parser support for
`f = { expr }` closure-literal binding, (c) `f.subscribe` sugar that
resolves to the wire address.

**Source shape:**
```
content *Text = "initial"
f = { content }
@bump = |v Text| -> { content <- v }
```

**Wire form** (post-refactor shape): an external caller sends
`{op: "subscribe", to: "@0", id: "1", from: "caller"}` and receives
`{id: "1", re: ["initial"], bv-a: ["Text"], to: "caller"}`. Mutating
`content` via `@bump` triggers a replay under the same subscription id.

**TDD**: test the closure's wire-level subscribe/replay behavior
directly, no template markup involved. Validates:
- Parser accepts `f = { expr }` closure-literal binding.
- Compiler allocates `@0` for it.
- Captured ref (`content`) triggers replay on mutation.
- Numeric and alphabetic names coexist cleanly in dispatch
  (`@0` for closure, `@bump` for handler).

**Not in Phase 1**: `f.subscribe |t Text| { ... }` source-level sugar
for the subscriber side. That's ergonomic layering on top of the wire
primitive — can be a separate small change once the primitive is
green, or folded in if cheap.

### Phase 2 — Template emission with closure addresses

Template parser recognizes `{ expr }` inside `<tag>…</tag>` as a dynamic
child slot. Element codegen emits `children` as a structured array
interleaving bare text strings and `<<@N>>` closure addresses.

**TDD**: actor with `@create = -> <div>{ @content }</div>`. Caller invokes
`@create`, asserts outbound `new` op has
`children: ["<<@0>>"]` (still sender-local frame — Phase 3 adds the
tree-global rewrite).

### Phase 3 — Transport translation

Outbound message emission runs a pre-emit scan. For each `<<…>>` fragment
in any string value, prepend the sender's own address-path to the
contents: `<<@0>>` → `<<sender-path @0>>`.

Because `<<` and `>>` can only appear inside JSON string literals,
the scan is raw-text regex on the serialized message — no object walk.

**TDD**: same actor, capture outbound bytes, assert `<<@0>>` became
`<<actor-path @0>>`. Exercise across all four targets.

**Per-target sites** (one hook each):
- JS: `#binding.post`
- Rust: `self.binding.send`
- Erlang: `io:put_chars([json_encode(M), $\n])`
- Browser runtime: `route()`

### Phase 4 — DOM subscribes to address children

Browser runtime's `DOM.div` (and sibling element constructors) `new`
handler walks the `children` array. Each `<<addr>>` string → post
`subscribe` to `addr`, route incoming `re` to the corresponding text
node. Bare strings → literal text as today.

**TDD**: browser test. DOM.div receives `new` with address child;
element text updates on the publisher actor's `set@content`.

### Phase 5 — End-to-end factory

Integration test of the full `notes/big-factory-example-2026-04-21.md`
example (minus the `/path.bv` singleton DI, which is Layer D). Factory
actor with `@content` and `@create`; caller invokes `Factory.create`,
appends result to body, writes `Factory.content <- "updated"`, asserts
DOM text updates.

No new code — composition only.

## Pre-coding open questions

1. **Template-interpolation parse state.** Does the existing template
   parser already produce an AST node for `{ expr }` inside
   `<tag>…</tag>`, or does it treat it as literal text / reject it?
   Check before Phase 1.
2. **Closure counter rule.** Depth-first AST walk per actor, allocating
   `@0`, `@1`, … in source-position order. Deterministic across
   compiles.
3. **`@0` vs. existing `@name` fns.** Numeric and alphabetic namespaces
   are disjoint by grammar (identifiers can't start with a digit). Need
   to sanity-check that dispatch machinery doesn't treat digits
   specially anywhere.
4. **Sender's address at transport-translate time.** Each actor instance
   knows its own address — needs a reliable accessor per target.

## What this does NOT include

- `\<<` escape convention — deferred.
- `/path.bv` singleton DI — Layer D in the factory-note plan.
- `el div = …` declaration form — Layer C.
- Element address round-trip through Factory — Layer E.
- Multi-dep closures with structural memoization — natural follow-up
  once single-dep works; same mechanism, comparison on replay.

## Cross-refs

- `notes/big-factory-example-2026-04-21.md` — full multi-layer plan
- `notes/reactive-closures-2026-04-13.md` — closure-as-addressable-entity model
- `notes/dom-as-actor-subsystem-2026-04-13.md` — DOM actor framing
- `notes/reactive-dom-lifecycle-2026-04-13.md` — JS DOM actor internals
- `notes/session-2026-04-20.md` — fn-subscribe landed across JS + Erlang
- Prior commit `fbed107` — CAM delimiter swap to `<<…>>`
