# `type` keyword; types belong to actors

Decided 2026-11-13. Supersedes the `::Name (fields)` declaration form and the rule in
`session-2026-11-07-instance-type-authority.md` that a type is declared at the top of a file.

## Declaration

```brevity
type Point (x Integer, y Integer)

type Point
  x Integer
  y Integer
```

- The literal keyword `type` declares a type. Delimited and lineal forms are unchanged otherwise.
- `::Point (…)` is not a declaration. It is unrecognized syntax, a plain parse error; the message
  does not mention any earlier form.
- Service documents use the same syntax: `{ type Point (x Integer, y Integer) }`.

## Names

- A type's name is its bare name, `Point`, internally and on the Opre wire. There is no `::` in
  the name.
- A type name is public. There is no private (`#Type`) or protected type at this time.
- `type Box` and a class `@Box` in the same scope conflict: compile error.

## Where a type is declared

- Anywhere in an actor's constructor block. A file is an actor, so file-level types are the file
  actor's types; a singleton is not special.
- A type in a class's constructor block escapes the constructor and belongs to the class. Every
  actor of that class shares it.
- Nesting is arbitrary: a class inside a class can declare types, reached as `A::B::X`.
- A type declaration may not depend on its containing actor: no field defaults from constructor
  params, no mutable reads. (A type could otherwise differ per instance; that is locked out for
  now.)

## `::` reaches a type through an actor

The left side of `::` names an actor: an injected service, a class, a singleton, or a constructed
actor.

```brevity
Class = *{
  type X (Integer)
}

actor = Class()
x = actor::X(123)
y = Class::X(123)
x = actor.X(123)          // error: `.` is a message, not a type
```

- Inside the declaring actor, the type is bare: `X(…)`.
- Outside, it needs the actor context: `Class::X`, `actor::X`, `Svc::Point`, `Singleton::Widget`.
- `A::X(…)` constructs the value locally, from the field list in `A`'s description. No message is
  sent. The same holds for an imported service: `Svc::Point(1, 2)` works without destructuring
  `Point` out of the header.
- The compiler must know `A`'s class statically (a constructed actor, an injected service, a
  typed local). Otherwise `A::X` is a compile error: without the class there is no authority to
  put in the tag.
- In type position, `::` is required: `p Class::X`. `p Class.X` is an error.
- `A::X` appears only before `(…)` (construction) or in type position. Anywhere else
  (`t = Class::X`) it is a compile error: a type is not a value.

## Wire tags

- A type tag is its authority's address followed by the bare name, with no `::`:
  `. Point`, `main Point`, `. Singleton Widget`, `. Class X`. The authority is the declaring
  class, not an instance (no `. Class 1 X`).
- A tag no longer shows by its shape that it names a type. A receiver recognises a type tag by
  looking the name up under its authority in the descriptions it knows: its own declarations and
  the service documents it imports. A tag it cannot resolve passes through as it does today.

## Service documents

A class's entry carries its types inside its interface block, recursively:

```
@Class (…) -> *{
  type X (Integer)
  …
}
```

A non-public class's types are visible only within its file.

## Open

- `self::X` as an explicit in-actor spelling: not needed now.
- Types declared inside a function body, rather than a constructor block.
- Types as values (`t = Class::X`, `svc.decode(Class::X, …)`): needs a type of types and a wire
  form for a type. Separate feature.
