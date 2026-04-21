# "The big one" — factory + app reactive DOM example (2026-04-21)

End-to-end composition: a singleton Factory actor holds reactive state, produces DOM elements for a consumer, and updates them live when the consumer writes back to the factory. Exercises every layer — singleton DI, cross-actor subscription, closure-as-addressable-entity on the wire, DOM as an actor subsystem — in ~10 lines.

## The example

**`/factory.bv`**

```
<DOM: (:div) *> {
  @content *Text = "initial"
  @create = -> <div>{ @content }</div>
}
```

**`app.bv`**

```
<
  DOM: (:div) *
  "/factory.bv": Factory *
> {
  el div = Factory.create
  DOM.document().body().append!(el)
  ...
  Factory.content <- "updated"
}
```

## Resolutions from today's discussion

### 1. Singleton DI via `/path.bv` + `*`

`/factory.bv` (leading slash) addresses the file in the browser-side system file tree as a **system-managed singleton**. Combined with `*` on the import (instance ref, not constructor), the system is responsible for DI — app.bv receives a ref to the already-instantiated service.

Contrasts with `#` on the import, which would make app.bv responsible for DI itself (caller-managed construction). `#` on imports is a new overload of the `#` sigil (distinct from its field-privacy use inside a service block) and worth pinning down explicitly before codifying.

**Not yet implemented or tested.** No existing tests reference `/path.bv` import paths or the `*`/`#` DI-mode distinction on imports.

### 2. Closures are subscribable addresses; DOM.div receives them as children

The closure `{ @content }` in `<div>{ @content }</div>` is a first-class addressable entity living in the actor whose refs it captures (here: Factory). Already matches the design in `notes/reactive-closures-2026-04-13.md`.

When `@create` evaluates its `<div>{ @content }</div>` expression, Factory sends a `new` op to `DOM.div` with the closure's **address** as a child, not its value. Sketch:

```
{ op: [{ children: ['`/factory.bv/_closure_0`'] }, 'new'] }
```

DOM.div then sends a `subscribe` op to that address, receives an initial `re` with the current value (`"initial"`), sets the text node, and keeps the subscription live. When Factory's `@content` changes, the closure re-evaluates and pushes a new `re`; DOM updates the text node.

**Op selector is `new`, not `new@div`.** Per existing tests at `__tests__/dom/element.browser.test.js`, the tag is part of the *address* (`DOM.div`), so the selector stays generic. A per-tag selector would be redundant.

**Closure is addressed under Factory**, not app.bv — the closure captures Factory's `@content`, so it runs in Factory's process. (The user's initial sketch `app.bv/_closure_0` appears to be a slip; should be `/factory.bv/_closure_0`.)

**Within-actor subscription firing is believed wired** (per 2026-04-20 session on fn/closure subscribe, JS + Erlang). Cross-actor subscription — where DOM.div (a separate actor) subscribes to a closure living in Factory — is the new verification point.

### 3. `append!` = mutate and return self

Convention (possibly enforced later): a trailing `!` on a method name indicates the method mutates and returns `self`. Enables `DOM.document().body().append!(el)` chaining. `append!` is already supported in current Brevity code.

## Open questions

### Syntax

- **`el div = Factory.create`** — binding syntax `<name> <Type> = <expr>`. Is this an existing form, or new? Most existing tests use `let`-style or no-keyword forms; need to confirm this declaration shape parses today.
- **`#` on imports vs `#` on fields** — same character, two contexts. Acceptable, but worth an explicit decision.
- **`*` vs no-marker on imports** — if `/path.bv` alone implies singleton-managed, is the `*` redundant? Or does `*` specifically mean "give me a ref to the instance" while bare `/path.bv` would mean "give me the type/constructor surface"?

### Wire / runtime

- **Closure address format** — `/factory.bv/_closure_0` (under the file path) or `FactoryInstance/_closure_0` (under the instance's runtime address)? For singletons the distinction collapses, but for caller-constructed instances we need an address that survives DI.
- **Closure-as-child serialization** — when a closure address appears in `children`, is it distinguished from a literal string (which today's tests use) by backtick-quoting on the wire? The element test shows element addresses as backtick-quoted — presumably closures follow suit, but not yet tested.
- **Return-path of `Factory.create`** — what app.bv binds to `el` is an element address. Is the address returned through Factory (Factory re-emits the `DOM.div/N` address it received), or does DOM reply directly to app.bv's call? The former keeps the actor tree coherent; the latter would require out-of-band routing.

### DI

- **Browser-side file tree** — what provides the `/path.bv` namespace? The DOM subsystem, a separate "modules" actor, the runtime itself? Needs to be picked before the system-DI path is implementable.
- **First-use instantiation** — does `/factory.bv` get instantiated on first reference, on system startup, or on demand at the import point? Matters for behavior of multiple concurrent importers.

## What already works (sanity-check list)

- Subscribe on public/private fns and closures within an actor (JS + Erlang) — `notes/session-2026-04-20.md`.
- `DOM.div` actor with `new` op, counter-based element addresses, addressable elements via `DOM.div/N` — `__tests__/dom/element.browser.test.js`.
- `<DOM: (:div) *>` import with destructure ctor signature — same test.
- Reactive closure model as addressable entity subscribing locally to refs — `notes/reactive-closures-2026-04-13.md`.
- DOM-as-actor-subsystem framing (elements addressable through DOM, not held as JS refs) — `notes/dom-as-actor-subsystem-2026-04-13.md`.

## What this example demands that isn't built yet

1. `/path.bv` system-singleton import resolution.
2. `*` vs `#` as DI-mode marker on imports.
3. Closure address embedded in a `children` array on the outbound `new` op (today's tests pass literal strings only).
4. DOM.div subscribing to a closure address it receives as a child, and applying received values to the element's text node.
5. The cross-actor write path: `Factory.content <- "updated"` from app.bv translating to `set@content` on Factory, which fires the local closure subscription, which pushes to the DOM-held element.
6. Element-address round-trip through `Factory.create` back to app.bv (or clarification that the address is already returned directly from DOM).

## Plan sketch (layers, smallest first)

**A — closure-as-child on the wire.** Codegen `<div>{ @ref }</div>` to emit `children: ['\`<actor>/_closure_N\`']` (backtick-quoted closure address) instead of inlined value. Browser test: `DOM.div` receives `new` with a closure-address child, issues `subscribe`, applies initial and subsequent `re`s. Single-actor (self-subscribe path already green).

**B — cross-actor closure subscription.** A second actor hosts the closure (Factory shape); DOM.div subscribes to it. Uses 2026-04-20 wire shape. Test: caller invokes `Factory.create`, receives element address, writes `Factory.content <- "x"`, element updates. Reactive guts without DI.

**C — `el div = Factory.create` declaration form.** Confirm whether `<name> <Type> = <expr>` parses today; add if not.

**D — `/path.bv` singleton import + system DI.** Import resolution for leading-slash paths → system-managed singletons. Runtime instantiates on first reference (or startup — decision needed). `*` marker on import = ref-to-instance. Test: two importers see same instance; writes from one visible to reads from the other.

**E — element address round-trip through Factory.** Verify Factory's reply to `@create` carries the `DOM.div/N` address back to caller cleanly. Likely works already; needs test.

**F — end-to-end integration test of the exact example.** Composes A–E. Two `.bv` files, asserts DOM text updates after `Factory.content <- "updated"`.

Order: A → B → C → E → D → F. D is the biggest; doing C and E first keeps the final integration test small. Reorder to D-first if singleton wiring turns out cheap.

## Questions to resolve before coding

1. **Closure address format.** `/factory.bv/_closure_0` (file-path-based) or `<runtime-instance-addr>/_closure_0` (instance-based)? Differ between singleton and caller-constructed?
2. **`*` on `/path.bv` — redundant?** If `/` already implies singleton-managed, what does `*` add? (a) `*` = ref-to-instance vs. bare = constructor surface; or (b) just uniformity with non-singleton `*` imports?
3. **`#` on imports as caller-DI.** Is `"factory.bv": Factory #` = app.bv constructs itself, using existing DI plumbing from `__tests__/services/dependency_injection.test.js`? Or new semantics?
4. **`el div = Factory.create`.** Parses today or new form? Word order `<name> <Type>` intentional (mirrors `el: div`) or should it be `div el` / `let el: div`?
5. **Closure return path through Factory.** Factory re-emits DOM.div's element-address reply as its own `re` to app.bv (standard chain), or app.bv gets address directly from DOM (out-of-band)?
6. **Layer order.** Anything partially built or with a gotcha that should reorder A–F?

## Finalized wire-format decisions (2026-04-21 discussion)

**Selector moves out of op, into `to` as a space-delimited suffix.** Op becomes the bare verb; the selector (when applicable) is appended to the address in the `to` field.

| Op | Before | After |
|---|---|---|
| subscribe | `op: "subscribe@field"`, `to: <actor>` | `op: "subscribe"`, `to: "<actor> @field"` |
| set | `op: "set@cell"`, `to: <actor>` | `op: "set"`, `to: "<actor> @cell"` |
| new | `op: [args, "new"]`, `to: "DOM.div"` | `op: [args, "new"]`, `to: "DOM @div"` |
| call public op | `op: "@innerHTML"` | unchanged — bare `@fn` *is* the call |

RPN preserved in the `op` array — args stay at position 0, verb at position 1. Only the `@field` suffix is removed from the verb.

**Element instance addresses become `DOM/1`, `DOM/2`** — sub-addresses dynamically provisioned by DOM, agnostic to which tag created them. Sub-actor `.`-namespacing collapses into selector form.

**Backticks hug the DI'd portion only, not the selector.** Example: `{to: "\`DOM\` @div"}`. Backticks mark coordinate-frame boundaries; `DOM` is a DI-injected remote reference needing translation at dispatch; `@div` is a selector in DOM's frame, already meaningful, no translation. Invariant: inside backticks = translate; outside = leave alone. Dispatcher uses backtick presence as the authoritative signal — no structural parsing.

**Local bare, remote backtick'd.** Self-sends: `{to: "@field"}` bare. Cross-actor sends: `{to: "\`Actor\` @field"}`. Dispatcher's single check is backtick-presence; no ambiguity.

**Closure naming: numeric, `@0`, `@1`, ...** — per-actor counter, source-position walk at compile time. Dynamic provisioning; no reserved prefix. Identifiers can't lex as digits, so the namespace is disjoint from user declarations by grammar.

**Reply-path question (whether receiver preserves backticks when forwarding an address) deferred** — no current caller forwards addresses; revisit when one does.

**Unsubscribe deferred** — not building it yet.

## Refactor status

**Task #1 (JS subscribe+set wire refactor) — landed.** Full JS suite 1647/1647 green.

- `src/codegen/javascript/statements.js`: `genSubscribeCall` and `ActorFieldSet` emit bare verb in `op`; selector goes into `to` (bare `@field` for self/child, `` `<alias>` @field `` for remote).
- `src/codegen/javascript/classes.js:#dispatch`: prologue normalizes bare `"subscribe"` / `"set"` → `subscribe@X` / `set@X` by parsing selector from `message.to`. Existing handler machinery unchanged downstream.
- `src/codegen/javascript/index.js:runActors.post`: parses `to` into `{alias, selector}` via backtick convention; routes by alias; strips alias when forwarding so receiver sees bare selector.
- Test harness helpers in `__tests__/{keywords,functions}/subscribe.test.js` got a `toAliasOf` shim that accepts both bare and backtick'd `to`.
- Test-fixture output assertions updated to new shape: `{op: "subscribe", to: "`Alias` @field"}`. Input fixtures left in old format — the dispatch prologue handles both formats, so old-format inputs continue to work (useful for tests that want to drive the actor directly without composing the sender's frame).

Erlang (#6) and Rust (#7) still pending; their test suites will be red until ported.

## Cross-refs

- `notes/reactive-closures-2026-04-13.md` — closure-as-addressable-entity model
- `notes/dom-as-actor-subsystem-2026-04-13.md` — elements are addressable through DOM, not held as refs
- `notes/reactive-dom-lifecycle-2026-04-13.md` — JS-target DOM actor internal bookkeeping
- `notes/session-2026-04-20.md` — subscribe on fns/closures landed on JS + Erlang
- `notes/subscription-via-multi-re-2026-04-18.md` — subscribe as regular CAM op
- `notes/dom-browser-namespaces-2026-04-18.md` — DOM namespace layout
- `__tests__/dom/element.browser.test.js` — existing DOM.div / element addressing tests
- `__tests__/services/dependency_injection.test.js` — existing DI surface (non-singleton)
