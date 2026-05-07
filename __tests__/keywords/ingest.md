# `ingest`

LLM orientation: `ingest` lets a superclass receive the direct subclass service
block's returned value during construction.

## Canonical Form

```brevity
Base = * {
  label Text = ingest
  @label = -> :label
}

Greeting = *(Base |) -> "hello"
```

With a default:

```brevity
Panel = * {
  content Text = ingest("")
  @content = -> :content
}
```

## Tested Behavior

- A superclass can bind `x Type = ingest`.
- A subclass `<Base |>` can return a value consumed by the superclass.
- Different subclasses can provide different ingested values.
- A default allows direct construction of the superclass.
- Constructor params and ingest coexist.
- The ingested value can be a computed expression.

## Pending / Do Not Overclaim

- Tests still mark mismatched typed ingest as todo.
- Tests still mark direct construction without a default as todo.

## LLM Rules

- Describe ingest as construction-time value flow, not an event or callback.
- Ingest is between a superclass and its direct subclass.
- Do not claim full type-error coverage beyond the current tests.
