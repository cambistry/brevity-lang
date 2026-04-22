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

### Phase 3 — Parent-layer address translation

**Key reframe:** a sender/responder does NOT know its own address
("contextual"). It emits messages in its own coordinate system. The
parent — the layer that holds the child and knows its address — is
the one that translates. So Phase 3 is not "outgoing from the actor
prepends" but rather "*incoming to the parent from the child* gets
prepended." Implementation site: the parent's routing seam, where
child messages are ferried to siblings.

**Rules** applied at the parent:

- **`to` field** — untouched. The sender writes `to: "DOM @div"` in
  its own DI frame; that stays application-absolute for now (no
  coordinate shift). Future cross-application routing may change this.
- **`from` field** — if missing/null/empty, parent fills in the child's
  address. If non-empty (a local-form like `@0` — an address inside
  the child), parent prepends the child's address, space-joined:
  `from: "<child-addr> @0"`.
- **Payload `<<…>>` addresses** — any angle-wrapped address in
  *local form* (contents starts with a non-word-character delimiter
  like `@` or `#`) gets its contents prepended with the child's
  address, space-joined inside the angles:
  `<<@0>>` → `<<child-addr @0>>`. Global forms (contents starts with
  a word character, e.g. `<<DOM/1>>`) are left alone. For this ticket
  only locals flow, so "always prepend local-form" is correct.

**Why space-inside-the-angles** (`<<X @0>>` not `<<X>> @0`): one-scan
parseability. A pre-parser regex sees "one complete address per
`<<…>>`" — no need to reason about whether an adjacent token belongs
to the address. The `<<…>>` delimiter means "this whole thing is one
address; treat contents carefully."

**Local-vs-global rule** (not needed in this ticket but stated here
for clarity): inside the `<<…>>`, leading character classifies the
frame. Non-word-character start (`@`, `#`) → local, prepend. Word-
character start (letter) → global, leave alone. This is definitional:
if globals could ever start with a delimiter, the discriminator
fails — so globals MUST always begin with a word character.

**Convention shift (definitional)**: file-path dep paths MUST NOT
begin with `/` (that was the old system-singleton marker and violates
the global-starts-with-word-char rule). Paths are `factory.bv` or
`folder/file.bv`, never `/factory.bv`. Affects Layer D (singleton DI)
when that lands.

**TDD**: capture outbound `new` op from the harness-spawned actor,
assert `children[0] === "<<self @0>>"` (where `self` is the test
harness's default selfAddr for spawned actors). Also assert `from`
defaults to `self` when sender omits it.

**Per-target sites** (one hook per routing layer):
- JS test harness: `spawnCompiled` / `createActor` in
  `src/codegen/browser/brevity.js` — the binding.post wrapper.
- Browser runtime routing: `route()` in `src/codegen/browser/runtime.js`
  (when multi-actor in-page scenarios flow; can land in this phase or
  later).
- Rust / Erlang: no parent-routing layer yet (one actor per process);
  defer until cross-process routing lands.

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
