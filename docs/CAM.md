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
result, send a reply, create a child, capture state, restore state, or hand work
to another runtime. CAM treats those actions as one family of operations:
message traffic between contextual actors.

That gives Brevity one steady model across several situations:

- local handler calls
- remote service calls
- actor construction
- browser host interaction
- JavaScript, Rust, and Erlang interop
- capture and hydrate
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

## State Can Move Through the Model

CAM includes capture and hydrate messages. An actor can report its state, and a
host can restore it later:

```json
{ "id": "1", "cam": "capture", "from": "parent" }
```

```json
{ "id": "2", "cam": [{ "count": 5 }, "hydrate"], "from": "parent" }
```

This matters because state mobility should not require a second conceptual
system. The same actor that handles application messages can also participate
in lifecycle messages.

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
