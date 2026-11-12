# Classes

LLM orientation: this directory covers actor construction — class headers,
class params, subclassing, wrapped parents, optional args, accessors, ingest,
and remote actor surfaces. The current vocabulary is **class** (the source
artifact) constructing an **actor** (the runtime entity).

## Current Class Model

- A class defines an actor's shape.
- `T = * { ... }` declares a no-arg class.
- `T = (x Integer, label: Text) *{ ... }` accepts positional and named params.
- Params can have defaults: `x Integer = 0`, `label: Text = "hi"`.
- Class params are private unless published with `@name`, which adds an accessor.
- Subclasses use `(Parent ++ own params) *{ … }`; several parents join with `++`; `D = C++` is a subclass with no changes.
- Hooked parent forms such as `(sup T ++) *{ … }` are tested.
- Remote classes use file-level DI and `*Name(...)`; see
  `../cam/remote_instance.md`.

## Canonical Examples

```brevity
Greeter = * {
  @hello = -> greeting: "hi"
}

Point = (x Integer, y Integer) *{
  @sum = -> total: (x + y)
}

Child = (Point ++ label: Text) *{
  @label = -> :label
}
```

A class declaration's `( ... )` is the **class header**; the trailing
`*{ ... }` is the **constructor block** — where state cells, handlers, and
projections live.

## Tested Areas

- Delimited class forms.
- File-level class params.
- Optional class args and defaults.
- Published params (`@name`) and their accessors.
- Ingest from subclass constructor blocks.
- Subclass arg inheritance and method override.
- Protected/private function access across subclasses.
- Wrapped superclass actors.
- Constructor blocks run in text order: reading or writing a cell above its declaration, directly or through a call or a constructed class, is a compile error.
- A nested class whose construction reads a later cell of the class around it isn't waited for: its read is answered at that cell's line, and using the child above that line is a compile error.
- Class interface rendering for `extract()`.

## LLM Rules

- Keep class examples close to tested syntax.
- Use `@T = ...` only when the class should appear in the extracted public
  service interface.
- Do not treat class params as plain record fields; reads are message calls
  when accessed from another actor.
- For remote actors, use `*Name(...)`, not the unprefixed call form.

## Documents

- [Published Class Params](accessors.md)
- [Class Ingest](ingest.md)
- [File-Level Dependency Injection](../services/dependency_injection.md)
