# Subscription as multi-response `re` (2026-04-18)

How Brevity expresses subscription to reactive values — public cells, closures, and user-defined observables. Extends `reactive-closures-2026-04-13.md` and `emit-subscribe-2026-03-27.md` by pinning the wire-level shape and the surface syntax.

## Core insight

**`subscribe` is not a special op. It is a regular op where the callee keeps replying.**

Same correlation `id`, same `re` shape, same local continuation machinery as any CAM call. The only difference: the callee doesn't terminate the correlation after the first `re` — it keeps sending `re` messages with the same `id` as the value changes.

No new wire verb. No semantic verb (`set`/`change`/`updated`) for notifications. The wire carries values, not meanings.

## Surface syntax

Literal method call, uniform across built-in reactive types:

```
c = C()
c.x.subscribe |val| { log("x = {val}") }
```

- `c.x` — scope-qualified cell address
- `.subscribe` — the method name (protocol op, see below)
- `|val|` — handler param, receives each delivered value
- block — fires on initial delivery *and* on every subsequent change

Closures use the same shape:

```
clos = c.fn         -- grabs the closure's address
clos.subscribe |val| { ... }
```

## Wire protocol

Subscription:

```
{ id: "123", op: "subscribe", to: `c.x`, from: `<subscriber>` }
```

Initial value (first `re`):

```
{ id: "123", re: 0 }
```

Subsequent changes reuse the same `id`:

```
{ id: "123", re: 1 }
{ id: "123", re: 2 }
```

The lambda is never sent on the wire. It's kept locally as the continuation for `id` `"123"` — identical to how any CAM call keeps its continuation local. Subscribe is simply the first case where that continuation doesn't free after one `re`.

## Properties that fall out

**Initial value is the first `re`.** No separate "current value" op is needed. `subscribe` returns current-and-future in one protocol.

**Unsubscribe is id cancellation.** Protocol-level message to cancel the correlation — no language keyword, no handler for an `unsubscribe` op.

**`subscribe` is a protocol, not a reserved name.** Built-in cells and closures implement it. User types opt in by handling the `subscribe` op. A user type is free to define `subscribe` to mean something else in its own domain — the name is conventional, not compiler-magic.

**Verb-free notifications.** The callee sends `re` with a value. Whether the value was set, derived, computed from three dependencies, or fetched from disk is publisher-side detail. The protocol stays clean.

**Continuation semantics are uniform.** Nothing about subscribe deviates from normal CAM call semantics. It's the same mechanism, just with a long-lived continuation on the caller side and a long-lived reply loop on the callee side.

## Interface shape for public reactive cells

Currently a public reactive cell surfaces as a getter/setter pair:

```
{
  x: () -> (Integer)
  set x: (Integer) -> .
}
```

With `*` already denoting actor-ref / reactive-ref in the language, the interface can compress to:

```
{
  x: *Integer
}
```

The `*` in interface position declares: this member exposes the reactive-cell protocol — get, set, and subscribe. Subscribers know `.subscribe` is available without it being enumerated as a third method.

Closures' interface surface is not settled yet and is left for a later note.

## Streaming ops as general capability

Generalizing the insight: **any op can send multiple `re` messages over time.** `subscribe` is just the named, common case. Other patterns fall out of the same primitive:

- Progress updates during long-running work
- Async iteration / paginated fetches
- Event streams
- Anything where the caller wants a flow, not a single answer

No new protocol for each — just correlation-id continuations that the callee keeps replying to. Brevity doesn't need a separate "observable" or "stream" type hierarchy; it's already in the message layer.

## What this resolves

- **The `set` vs `change` vs `updated` verb question.** Answer: none of them. No verb.
- **The "reserved keyword" concern for language-level ops.** Answer: `subscribe` isn't reserved as a language keyword; it's a method name that built-in reactive types implement. User code is free to define `.subscribe` with different semantics on its own types.
- **The initial-value question.** Answer: first `re`.
- **The unsubscribe question.** Answer: cancel the id.

## Cross-references

- `notes/reactive-closures-2026-04-13.md` — closures as addressable reactive entities with subscribe/notify interface
- `notes/reactive-dom-lifecycle-2026-04-13.md` — lifecycle/GC concerns for subscriptions in the JS DOM target
- `notes/emit-subscribe-2026-03-27.md` — the `f.fire = { ... }` subscription pattern for explicit emits (remains the shape for declared, named events)
- `notes/backticks-as-dynamic-names-2026-04-16.md` — backtick addresses used in wire-format examples here
