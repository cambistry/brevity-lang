# `ingest`

`ingest` lets a superclass receive the result of a subclass's service block
during actor construction.

Normally, a constructor's service block runs and its return value (if any)
is discarded. `ingest` changes that: the superclass pauses its own
initialization, lets the subclass run its service block, and then resumes with
the returned value.

## The basic form

A superclass uses `ingest` in its service block:

```brevity
Base = <> {
  label Text = ingest
  @label = -> :label as Text
}
```

A subclass provides the value by returning from its service block:

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
Base()     -- compiler :error Base uses ingest, requires a subclass
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

Now `Panel()` is valid — `content` defaults to `""`. But a subclass can still
specialize it:

```brevity
Greeting = <Panel |> -> "hello"
```

This is useful for types that are fully functional on their own but can be
specialized through subclasses.

## Why this exists

Subclasses in Brevity inherit params and handlers from their superclass. But
sometimes the superclass needs to incorporate a value that only the subclass can
provide — a name, a configuration, child content for templating.

Without `ingest`, the only option would be a constructor parameter:

```brevity
Base = <:label Text> {
  @label = -> :label as Text
}
```

This is awkward because the subclass doesn't "know" the label at the call site
— it's part of the subclass's own identity, not something passed in from
outside.

`ingest` lets the value flow inward (from subclass service block to superclass
initialization) instead of outward (from caller to constructor).

## Type checking

The superclass can declare the expected type of the ingested value:

```brevity
Base = <> {
  label Text = ingest
}
```

If a subclass returns a value of the wrong type, the compiler catches this at
the subclass definition site. The ingest type is part of the superclass's
interface so that even remote subclasses can be validated:

```
{
  ingest Text
  @label: -> Text
}
```

## Multiple levels

Each `ingest` is a local relationship between one superclass and its direct
subclass. They don't interact or relay through each other.

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

If a type both provides a value to its superclass *and* ingests from its own
subclasses, those are two independent operations:

```brevity
A = <> { fromB Text = ingest }

B = <A |> {
  fromC Integer = ingest    -- B ingests from its own subclasses
  -> "value for A"          -- B provides to A (independent of fromC)
}
```

B's return to A is fixed — it doesn't depend on what B ingests from C.

## What ingest says about Brevity

`ingest` reinforces a core Brevity idea: the type hierarchy is a
collaboration, not just a mechanism for code reuse. The superclass and subclass
cooperate during construction, with `ingest` as the channel for the subclass to
contribute to the superclass's state.

This keeps the superclass in control of its own initialization while still
allowing subclasses to inject meaning into it.
