# Actors with a `new`

LLM orientation: this directory covers actor construction — constructor headers
and params, subclassing, the parent layer (`base`), optional args, accessors,
actors as values, and remote actor surfaces. There are no classes, only **actors**:
`T = *(…) { … }` declares the actor `T`, whose `new` builds others, and those are of
class `T`. "Class" names only that relationship (notes/actors-not-classes-2026-11-18.md).

## Current Model

- An actor with a `new` defines the shape of the actors it builds.
- `T = * { ... }` declares one whose `new` takes no args.
- `T = *(x Integer, label: Text) { ... }` accepts positional and named params.
- Params can have defaults: `x Integer = 0`, `label: Text = "hi"`.
- Constructor params are private unless published with `@name`, which adds an accessor.
- Subclasses use `Parent ^ *(own params) { super(…) … }`: a constructor of its own takes its own params only, and `super` runs the parent's constructor at that line (`super.test.js`). Bare `super` passes the args as received, `super()` none, `super[A](…)` one of several parents. Never calling it builds no base, legal only when the subclass defines the parent's whole public interface. Several parents join with `^`; `D = C^` is a subclass with no changes, which takes its parent's params.
- `base::h()` / `base.a()` / `base[T]::h()` reach the parent layer (`base.test.js`).
- In a function, `super` is the parent layer's same function: `base::h(…)` in `h`, `base.h(…)` in `@h`; bare passes the args as received (`super.test.js`).
- A subclass's own class block extends its parent's by delegation (`delegation.test.js`, `extend.test.js`): it registers with the parent block (`$extend`); a call for a function it doesn't define, `super` and `base::h()` run at the parent for it (`as`), late-bound through callbacks to its overrides and redeclared cells; `A.f()` runs as the parent; a cell it doesn't redeclare is the parent block's, read and written there (`~` ops), and forwarded for the class's actors.
- `class::base` is the running class's parent, late-bound: `class::base::h()`, `.f()`, `(…)` (`super.test.js`).
- An actor is a value: `k = T` holds its address, typed `Actor`, tagged `*` (actor_value.test.js).
- Remote actors with a `new` use file-level DI and `*Name(...)`; see
  `../cam/remote_instance.md`.

## Canonical Examples

```brevity
Greeter = * {
  @hello = () -> greeting: "hi"
}

Point = *(x Integer, y Integer) {
  @sum = () -> total: (x + y)
}

Child = Point ^ *(x Integer, y Integer, label: Text) {
  super(x, y)
  @label = () -> :label
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
- A constructor block's `return`: an early exit, never a value.
- Subclass constructors: `super` forwarding, its every-path rule, and method override.
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
- [File-Level Dependency Injection](../services/dependency_injection.md)
