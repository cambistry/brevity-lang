# Constructors

LLM orientation: this directory covers actor construction, constructor params,
subclassing, wrapped parents, optional args, accessors, ingest, and remote-like
instance surfaces.

## Current Constructor Model

- A constructor defines an actor class.
- `T = <> { ... }` creates a no-arg constructor.
- `T = <x Integer, :label Text> { ... }` accepts positional and named params.
- Params can have defaults: `x Integer = 0`, `:label Text = "hi"`.
- Constructor params can synthesize accessors unless suppressed.
- Subclasses use `<Parent | own params>`.
- Wrapped parent instance forms such as `<T *sup |>` are tested.
- Remote dependency constructors use file-level DI and `Name!(...)`; see
  `../cam/remote_instance.md`.

## Canonical Examples

```brevity
Greeter = <> {
  @hello = -> greeting: "hi"
}

Point = <x Integer, y Integer> {
  @sum = -> total: (x + y)
}

Child = <Point | :label Text> {
  @label = -> :label
}
```

## Tested Areas

- Delimited constructor forms.
- File-level constructor params.
- Optional constructor args and defaults.
- Auto-accessors and suppressed/remapped accessors.
- Ingest from subclass service blocks.
- Subclass arg inheritance and method override.
- Protected/private function access across subclasses.
- Wrapped superclass instances.
- Constructor interface rendering for `extract()`.

## LLM Rules

- Keep constructor examples close to tested syntax.
- Use `@T = ...` only when the constructor should appear in the extracted public
  service interface.
- Do not treat constructor params as plain record fields; reads are message
  calls when accessed from another actor.
- For remote instances, use `Name!(...)`, not constructor syntax alone.

## Documents

- [Constructor Parameter Accessors](accessors.md)
- [Constructor Ingest](ingest.md)
- [File-Level Dependency Injection](../services/dependency_injection.md)
