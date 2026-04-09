# `extract()`

`extract()` is the first half of Brevity's host API.

It parses source and returns enough structured information for tooling to reason
about the file before committing to full compilation.

## The basic role

```js
const { ast, interface: iface, useDecls } = extract(source)
```

This gives the host:

- `ast`: the parsed program
- `interface.service`: the public surface of the actor in service-document form
- `useDecls`: the named remote collaborators declared with `uses`

That is already enough for a surprising amount of tooling work.

## Why this exists as a separate phase

If Brevity supported only a one-shot `compile(source)` API, the host would have
to discover dependencies during compilation itself. That becomes awkward as soon
as compilation may depend on information not present locally in the file.

`extract()` solves that by separating:

- parsing and interface discovery
- validation and code generation

This gives the host a chance to resolve remote interfaces or dependency
information before calling `compile(...)`.

## The interface matters

One of the most important outputs of `extract()` is the interface.

That interface is a compact description of the actor's public callable surface.
It gives other tools and actors something to reason about without needing the
full original source text.

This is a key part of Brevity's larger architecture: interfaces are meant to be
portable, inspectable, and useful for compilation-time checking across actor
boundaries.

## `extract()` does not validate everything

Another important property is that `extract()` is intentionally lighter than
full compilation.

It can succeed in cases where `compile(...)` would still need more information,
such as remote interfaces for `uses` declarations. That is not a weakness. It is
the point of the split.

`extract()` is about discovering the shape of the file; `compile(...)` is about
proving and emitting a target-specific version of it.

## Why this matters for Brevity as a project

The existence of `extract()` says something important about the intended future
of the language.

Brevity is not only meant to be compiled in isolation. It is meant to live in a
tooling environment where actors can expose interfaces, where hosts can inspect
dependencies, and where compilation can be staged rather than monolithic.

That makes the host API part of the language story, not just a packaging detail.
