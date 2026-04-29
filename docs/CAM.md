# CAM: The Contextual Actor Model

CAM, the Contextual Actor Model, is the organizing idea behind Brevity.

In CAM, a program is a tree of actors. Each actor has behavior, state, a public
message surface, and a context that determines which other actors it can
address. A child actor is not just "an object inside" a parent. It is a
participant whose identity and authority are defined by where it lives in the
actor tree.

Brevity is the language layer for writing those actors.

## The Core Claim

Application systems are mostly boundary management.

They receive a message, consult state, call another service, transform a
result, send a reply, create a child, subscribe to future values, or hand work
to another runtime. CAM treats those actions as one family of operations:
message traffic between contextual actors.

That gives Brevity one steady model across several situations:

- local handler calls
- remote service calls
- actor construction
- browser host interaction
- JavaScript, Rust, and Erlang interop
- subscriptions as repeated replies
- testing through message injection

## Actors Have Context

An actor does not live in a global namespace. It is hosted by a context.

That context can provide constructor values, dependency actors, remote service
interfaces, browser facilities, or parent-child routing. Brevity exposes that
context with a top-level constructor/dependency boundary:

```brevity
<
  "/services/store": (Store) {
    get: (:key Text) -> (:value Text)
  }
>
=

@fetch = |:key Text| {
  :value Text = Store.get(:key)
  -> :value
}
```

The actor can call `Store` because `Store` is part of its declared context.
That call may be local or remote, but the source-level relationship is the
same: send a typed message to an actor that the context made available.

## Public Surface Is Message Surface

In Brevity, `@` marks public handlers:

```brevity
@ping = -> status: "ok"
```

That handler is not merely a method. It is a message the actor accepts. This is
why public API, type checking, test injection, and wire behavior are tied
together: they all describe what messages can cross the actor boundary.

Private functions share the same conceptual path. Brevity's self-send model
routes internal behavior through actor dispatch, preserving the idea that actor
behavior is addressed by messages even when the compiler can optimize local
execution.

## Messages Use `op` and `re`

A normal CAM request names an operation with `op`. If the operation replies, the
reply comes back as `re` with the same `id`.

```json
{
  "id": "100",
  "op": [{ "url": "https://example.com" }, "@get"],
  "from": "Primary",
  "bv-a": [{ "url": "Text" }]
}
```

```json
{
  "id": "100",
  "re": { "response": "hello" },
  "to": "Primary",
  "bv-a": { "response": "Text" }
}
```

The `id` is the correlation key. `from` and `to` describe routing. `bv-a`
carries Brevity's type attestation for the message payload or reply.

An operation with no payload can be just a selector:

```json
{ "id": "1", "op": "@ping", "from": "Tester" }
```

and its reply can still be structured:

```json
{ "id": "1", "re": { "status": "ok" }, "to": "Tester" }
```

Actor creation is also a message. The construction operation is `#new`, and the
reply supplies an address that later messages can target:

```json
{ "id": "1", "op": [{ "path": "/main" }, "#new"], "to": "WebView" }
```

```json
{ "id": "1", "re": "#<WebView/1>", "bv-a": "#<WebView>", "from": "WebView" }
```

After that, ordinary messages go to the returned actor address:

```json
{ "id": "2", "op": "@open", "to": "WebView/1" }
```

## Subscriptions Are Repeated Replies

A subscription is almost a normal message exchange. The subscriber sends an
`op`; the publisher replies with `re`. The difference is that the publisher may
send more than one `re` for the same `id`.

For a local or remote value subscription, the request can look like this:

```json
{ "id": "9", "op": "subscribe@val", "from": "Subscriber" }
```

The first reply carries the current value:

```json
{ "id": "9", "re": [0], "to": "Subscriber", "bv-a": ["Integer"] }
```

Later changes replay through the same correlation:

```json
{ "id": "9", "re": [7], "to": "Subscriber", "bv-a": ["Integer"] }
```

```json
{ "id": "9", "re": [20], "to": "Subscriber", "bv-a": ["Integer"] }
```

Remote function subscriptions use the same idea with an addressed member:

```json
{ "id": "1", "op": "@subscribe", "to": "#<Remote @val>" }
```

The important point is that subscription does not introduce a second protocol.
It is the same request/reply shape, with the reply channel intentionally left
open for future values.

## Runtime Boundaries Are Actor Boundaries

Brevity compiles to multiple targets because CAM does not require every actor to
share one implementation language. A JavaScript actor, a Rust actor, an Erlang
actor, a browser-hosted actor, and a native service can all participate if they
speak the message protocol.

That is the practical interop story:

- Brevity source defines actor behavior and typed message shapes.
- The compiler emits target-specific code.
- The host routes messages.
- Foreign code can join by behaving like an actor.

CAM is therefore also Brevity's foreign-function model. The foreign boundary is
not an escape from the language model; it is another actor boundary.

## What CAM Does Not Claim

CAM is the application model, not a promise that this repository already
contains every piece of distributed infrastructure.

Discovery, edge establishment, durable routing, deployment, cryptography, and
cluster management can exist around Brevity actors. The important point is that
application logic can talk to those capabilities as actors instead of embedding
transport-specific machinery throughout the source.

## Brevity In One Sentence

Brevity is CAM made writable: a compact language for defining contextual actors
whose public behavior, dependencies, state, and cross-runtime interactions are
all expressed as message-shaped code.
