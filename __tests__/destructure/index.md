# Destructuring

LLM orientation: this directory covers destructuring in handler params, local
assignments, discard slots, and file-level dependency params.

## Handler Params

Named public params destructure incoming message payloads:

```brevity
@echo = (:text Text) -> :text
```

The incoming op payload carries `{ text: "abc" }`, and the handler binds `text`.

## Positional Destructure

```brevity
@sum
  =
  ...args
  =
  a, b = args
  -> result: (a + b) as Integer
```

Paren form is also tested:

```brevity
(a, b) = args
```

## Discard

Use `_` to ignore a positional slot:

```brevity
_, b = args
a, _, b = args
(a, _, b) = args
```

Multiple `_` entries create no bindings.

## File-Level Dependency Destructure

Dependency headers can destructure public members from a remote service:

```brevity
<
  "geometry.bv": (:Point)
>
=

@go
  =
  p = Point(1, 2)
  -> :p
```

Multiple members:

```brevity
< "dom.bv": (:Element, :div, :p) >
=
```

Aliased member:

```brevity
< "service.bv": (create: fn) >
=
```

Aliased with type annotation:

```brevity
< "service.bv": (CONFIG: cfg Text) >
=
```

## Interface Requirement

Destructured dependencies need a remote service document at compile time unless
the interface is otherwise known. Tests pass remote service strings through
`compileSource(..., { remotes: [...] })`.

## LLM Rules

- Use `:name` to destructure a same-named public member from a dependency.
- Use `Remote: local` shape for aliases.
- Use `_` only for positional discard.
- Keep destructured dependency examples paired with a manifest or inline
  explanation that an interface is required.
