# Actors with a `new`

LLM orientation: this directory covers actor construction — constructor headers
and params, subclassing, the parent layer (`super`), optional args, accessors, ingest,
actors as values, and remote actor surfaces. There are no classes, only **actors**:
`T = (…) *{ … }` declares the actor `T`, whose `new` builds others, and those are of
class `T`. "Class" names only that relationship (notes/actors-not-classes-2026-11-18.md).

## Current Model

- An actor with a `new` defines the shape of the actors it builds.
- `T = * { ... }` declares one whose `new` takes no args.
- `T = (x Integer, label: Text) *{ ... }` accepts positional and named params.
- Params can have defaults: `x Integer = 0`, `label: Text = "hi"`.
- Constructor params are private unless published with `@name`, which adds an accessor.
- Subclasses use `Parent ++ (own params) *{ … }`; several parents join with `++`; `D = C++` is a subclass with no changes.
- `super::h()` / `super.a()` / `super[T]::h()` reach the parent layer (`super.test.js`); the wrapped `(sup T ++)` form is retired.
- An actor is a value: `k = T` holds its address, typed `Actor`, tagged `*` (actor_value.test.js).
- Remote actors with a `new` use file-level DI and `*Name(...)`; see
  `../cam/remote_instance.md`.

## Canonical Examples

```brevity
Greeter = * {
  @hello = -> greeting: "hi"
}

Point = (x Integer, y Integer) *{
  @sum = -> total: (x + y)
}

Child = Point ++ (label: Text) *{
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

- [Published Constructor Params](accessors.md)
- [Class Ingest](ingest.md)
- [File-Level Dependency Injection](../services/dependency_injection.md)
