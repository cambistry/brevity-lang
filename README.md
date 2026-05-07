# Brevity

Brevity is a language for writing actors in the Contextual Actor Model, or CAM.

CAM is the center of the project: software is a tree of actors, actors
communicate by messages, and every actor is understood in the context that hosts
it. Brevity is the source language that makes that model small enough to write
directly.

The file is the actor. Its public surface is the set of messages it accepts.
Its dependencies are actors in its surrounding context. Its state can be
captured, hydrated, moved, tested, and compiled across runtimes without changing
the conceptual model.

Brevity currently compiles to JavaScript, Rust, Erlang, and a browser-oriented
JavaScript host.

## Why CAM

Most application code has to cross boundaries: process boundaries, language
boundaries, trust boundaries, device boundaries, and time boundaries between
state capture and replay. CAM treats those boundaries as the ordinary shape of
the program instead of as exceptional infrastructure.

In CAM:

- an actor is the unit of behavior
- a message is the unit of interaction
- an actor's context defines what it can address
- public handlers define the actor's message surface
- actor state can be captured and hydrated through the same model
- foreign runtimes are just actors that speak the protocol

Brevity exists to make that model feel local while keeping the boundary visible.
Calling another actor can read like a function call, but the source still knows
that a message is being sent to a declared participant.

## What Brevity Adds

Brevity is intentionally narrow. It is not trying to replace JavaScript, Rust,
or Erlang as a general-purpose language. It is for the application layer of
actor-shaped systems: handlers, state transitions, dependencies, replies, and
typed message contracts.

The language keeps a small center of gravity:

- `@name` defines a public message handler
- `*(...)` defines construction-time context and dependencies
- `Type!` marks mutable or actor-like cells
- `Name!(...)` creates a messageable actor-like instance
- replies are explicit data shapes
- local and remote interaction share one message-oriented model

That is the philosophical bet: if the language is honest about actors and
messages at the source level, then distribution, interop, testing, and
serialization can become normal language concerns rather than framework glue.

## Tiny Example

```brevity
count Integer! = 0

@inc = {
  count <- count + 1
  -> value: count
}

@get = -> value: count
```

The file hosts one actor. `@inc` and `@get` are public messages. `count` is
actor state.

## Boundary Example

```brevity
*(
  "/services/store": (Store) {
    get: (:key Text) -> (:value Text)
  }
)
=

@fetch = (:key Text) {
  :value Text = Store.get(:key)
  -> :value
}
```

`Store.get(...)` looks direct, but `Store` is declared in the actor's context.
The call is a typed message across an explicit boundary.

## Repository Map

- [docs/README.md](./docs/README.md) is the documentation index.
- [docs/CAM.md](./docs/CAM.md) introduces the Contextual Actor Model.
- [LANGUAGE_OVERVIEW.md](./LANGUAGE_OVERVIEW.md) gives the compact language
  model.
- [docs/LLM_WRITING_BREVITY.md](./docs/LLM_WRITING_BREVITY.md) gives agents a
  fast path for generating current Brevity source.
- [docs/SYNTAX_CRIB.md](./docs/SYNTAX_CRIB.md) is a compact current syntax
  pattern sheet.
- [LANGUAGE_FEATURES.md](./LANGUAGE_FEATURES.md) indexes implemented feature
  notes and test-backed examples.
- [USAGE.md](./USAGE.md) documents the host API, compile targets, and wire
  format.
- [docs/NOTES.md](./docs/NOTES.md) indexes the design-note archive.
- [docs/PUBLIC_RELEASE.md](./docs/PUBLIC_RELEASE.md) tracks remaining
  public-release hygiene.

## Current Status

Brevity is early, experimental language infrastructure. The compiler, runtime
targets, tests, and design notes are moving together. Public readers should
start with CAM and the language overview before treating individual notes as
settled specification.

## Development

```bash
npm install
npm test
```

The package exports a small JavaScript host API:

```js
import { extract, compile } from 'brevity-lang';

const { ast, interface: iface } = extract(source);
const output = compile(ast, { target: 'js' });
```

`extract()` parses source and returns host-facing metadata. `compile()` validates
the AST and emits code for a target runtime.
