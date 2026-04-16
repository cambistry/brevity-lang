# `ingest`

`ingest` lets a supertype receive the result of a subtype's service block
during actor construction.

Normally, a constructor's service block runs and its return value (if any)
is discarded. `ingest` changes that: the supertype pauses its own
initialization, lets the subtype run its service block, and then resumes with
the returned value.

## The basic form

A supertype uses `ingest` in its service block:

```brevity
Base = <> {
  label Text = ingest
  @label = -> :label as Text
}
```

A subtype provides the value by returning from its service block:

```brevity
Child = <Base |> -> "hello"
```

When `Child()` is constructed:

1. Base begins its service block
2. Base hits `ingest` and pauses
3. Child's service block runs, returning `"hello"`
4. Base resumes — `label` is now `"hello"`
5. Construction completes

A type that uses `ingest` without a default cannot be constructed directly —
it must be subtyped:

```brevity
Base()     -- compiler :error Base uses ingest, requires a subtype
Child()    -- :ok Child provides the value
```

## Default values

`ingest` can provide a fallback for direct construction:

```brevity
Panel = <> {
  content Text = ingest("")
  @content = -> :content as Text
}
```

Now `Panel()` is valid — `content` defaults to `""`. But a subtype can still
specialize it:

```brevity
Greeting = <Panel |> -> "hello"
```

This is useful for types that are fully functional on their own but can be
specialized through subtypes.

## Why this exists

Subtypes in Brevity inherit params and handlers from their supertype. But
sometimes the supertype needs to incorporate a value that only the subtype can
provide — a name, a configuration, child content for templating.

Without `ingest`, the only option would be a constructor parameter:

```brevity
Base = <:label Text> {
  @label = -> :label as Text
}
```

This is awkward because the subtype doesn't "know" the label at the call site
— it's part of the subtype's own identity, not something passed in from
outside.

`ingest` lets the value flow inward (from subtype service block to supertype
initialization) instead of outward (from caller to constructor).

## Type checking

The supertype can declare the expected type of the ingested value:

```brevity
Base = <> {
  label Text = ingest
}
```

If a subtype returns a value of the wrong type, the compiler catches this at
the subtype definition site. The ingest type is part of the supertype's
interface so that even remote subtypes can be validated:

```
{
  ingest Text
  @label: -> Text
}
```

## Multiple levels

Each `ingest` is a local relationship between one supertype and its direct
subtype. They don't interact or relay through each other.

A type that uses `ingest`:

```brevity
Base = <> { label Text = ingest }
Named = <Base |> -> "hello"
```

A different type that also uses `ingest`:

```brevity
Container = <> { count Integer = ingest }
Sized = <Container |> -> 5
```

If a type both provides a value to its supertype *and* ingests from its own
subtypes, those are two independent operations:

```brevity
A = <> { fromB Text = ingest }

B = <A |> {
  fromC Integer = ingest    -- B ingests from its own subtypes
  -> "value for A"          -- B provides to A (independent of fromC)
}
```

B's return to A is fixed — it doesn't depend on what B ingests from C.

## What ingest says about Brevity

`ingest` reinforces a core Brevity idea: the type hierarchy is a
collaboration, not just a mechanism for code reuse. The supertype and subtype
cooperate during construction, with `ingest` as the channel for the subtype to
contribute to the supertype's state.

This keeps the supertype in control of its own initialization while still
allowing subtypes to inject meaning into it.
