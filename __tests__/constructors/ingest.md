# Constructor Ingest

LLM orientation: this is the constructor-level companion to
[`keywords/ingest.md`](../keywords/ingest.md). Keep examples aligned with
`ingest.test.js`.

## Construction Sequence

When a superclass service block evaluates `ingest`:

1. The superclass begins construction.
2. The superclass pauses at `ingest`.
3. The direct subclass service block runs.
4. The subclass's return value is delivered to the superclass.
5. The superclass resumes with the ingested binding.

## Current Examples

```brevity
Base = <> {
  label Text = ingest
  @label = -> :label
}

Greeting = <Base |> -> "hello"
```

```brevity
Labeled = <:id Integer> {
  label Text = ingest
  @id = -> :id
  @label = -> :label
}

Widget = <Labeled |> -> "widget"
```

## Tested Behavior

- Basic superclass/subclass ingest.
- Multiple subclasses supplying different values.
- Defaults with direct superclass construction.
- Superclass params alongside ingest.
- Computed subclass return expressions.

## LLM Rules

- Use `<Base |>` for subclassing examples.
- Use `ingest(default)` only when direct superclass construction should work.
- Do not claim multi-level relay behavior unless citing a specific test.
- Do not overstate compile-time rejection for typed mismatch; those tests are
  currently todo.
