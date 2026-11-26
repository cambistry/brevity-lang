---
created: 2026-05-20
---
# Class and type introspection: the class of a value, is-a, equality

## The class of a value (`type of` / `#type`)

Want: gets a fully qualified address pointer to a type or class declaration. Must work:

- When the type/class is defined inside a file
- When the type/class IS the file
- Within the same file (which must use Opre-relative internal addressing)

Spelling in Brevity is open: `class(obj)`, `class of obj`, or similar. On the wire, the class of an address is `X:*`, reduced by whoever knows `X`'s class (notes/class-of-and-self-return-2026-11-23.md), not a `#class` op.

## Is-a

Want: a runtime test that a value is an instance of a class or any of its subclasses, or of a type.

Today: compile-time assignability already follows ancestry for params (`g = (p P) -> …` takes a subclass of `P`).

## Equality

Decide: what `==` means between classes and between types.

Today: `P == Q` on two declared classes compiles, with no defined meaning: address identity, or structure?

## Open

What is the type of a type or class value, e.g. `A::B`? `type`? These need a typology alongside function types.
