# `capture`

`capture` lets a supertype receive the result of a subtype's declaration block
during actor construction.

Normally, a constructor's declaration block runs and its return value (if any)
is discarded. `capture` changes that: the supertype pauses its own
initialization, lets the subtype run its declarations, and then resumes with
the returned value.

## The basic form

A supertype uses `capture` in its declaration body:

```brevity
Base = <> {
  label Text = capture
  @label = -> :label as Text
}
```

A subtype provides the value by returning from its declaration block:

```brevity
Child = <<Base>> -> "hello"
```

When `Child()` is constructed:

1. Base begins its declaration
2. Base hits `capture` and pauses
3. Child's declaration block runs, returning `"hello"`
4. Base resumes — `label` is now `"hello"`
5. Construction completes

## Why this exists

Subtypes in Brevity inherit params and handlers from their supertype. But
sometimes the supertype needs to incorporate a value that only the subtype can
provide — a name, a configuration, a computed default.

Without `capture`, the only option would be a constructor parameter:

```brevity
Base = <label: Text> {
  @label = -> :label as Text
}
Child = <<Base>> -- but how does Child set label?
```

This is awkward because the subtype doesn't "know" the label at the call site
— it's part of the subtype's own identity, not something passed in from
outside.

`capture` lets the value flow inward (from subtype declaration to supertype
initialization) instead of outward (from caller to constructor).

## Type checking

The supertype can declare the expected type of the captured value:

```brevity
Base = <> {
  label Text = capture
}
```

If a subtype returns a value of the wrong type, the compiler should catch this
at the subtype definition site. The capture type is part of the supertype's
interface — it appears in the service manifest so that even remote subtypes can
be validated:

```
{
  capture Text
  @label: -> Text
}
```

## Chaining

Each level in a type hierarchy can have its own `capture`. A subtype can both
provide a value to its supertype's `capture` and use `capture` itself to
receive from its own subtypes:

```brevity
A = <> { x Text = capture }
B = <<A>> { y Integer = capture; -> "from B" }
C = <<B>> -> 42
```

When `C()` is constructed:
1. A begins, hits capture, pauses
2. B begins, hits capture, pauses
3. C's block runs, returns 42
4. B resumes — `y` is 42, B returns `"from B"`
5. A resumes — `x` is `"from B"`

## When capture is absent

If a supertype uses `capture` but the subtype's declaration block does not
return a value (or returns nothing), the captured value is null. The supertype
can guard against this with optional types:

```brevity
Base = <> {
  label Text? = capture
}
```

## What capture says about Brevity

`capture` reinforces a core Brevity idea: the type hierarchy is a
collaboration, not just a mechanism for code reuse. The supertype and subtype
cooperate during construction, with `capture` as the channel for the subtype
to contribute to the supertype's state.

This keeps the supertype in control of its own initialization while still
allowing subtypes to inject meaning into it.
