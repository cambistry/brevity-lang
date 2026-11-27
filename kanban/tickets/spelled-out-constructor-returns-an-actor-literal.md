---
created: 2026-11-26
---
# The spelled-out constructor: `(p) -> actor { … }`

Design: `notes/constructor-star-prefix-2026-11-25.md`. Split from `constructor-star-leads`, which made `*(p) { … }` the constructor form.

Want: `(p) -> actor { … }` means what `*(p) { … }` does: a function that builds and returns a new actor on each call. Bound to a name it names a class, as an actor's `new` it attaches to that actor, and as a `^` layer it composes. It types and documents the same as the sugar.

Today: `(p) -> actor { … }` and `(p) { actor { … } }` are parse errors.

Needs:

- an actor literal as a value (after `->`, and as a body's returned value);
- the literal closing over the call's params, as an instance reads its constructor params;
- each evaluation building a new actor (unlike a singleton, built once with its enclosing actor).

Open (from the note): is a body that returns an actor literal on only some paths a constructor?
