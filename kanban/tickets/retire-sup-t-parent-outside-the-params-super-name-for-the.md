---
status: done
created: 2026-11-17
---
# Retire `(sup T ++)`: parent outside the params, `super::name` for the parent layer

Background: discussion of 2026-11-16. The wrapped form `(sup T ++)` bound the parent as a local, which is why the parent sat inside the param list. It's being dropped, so the parent is no longer a param of anything and moves outside. Super-access gets its own syntax instead of member access on a local. (Also fixes a bug: today wrapping makes the parent a separate actor, so overrides stop being late-bound. With `(sup T ++)`, T's code calling a protected `h` gets T's `h`, not the subclass's.)

New forms

```
U = T ++ (u Text) *{ … }            parent outside the params
U = A ++ B ++ (u Text) *{ … }       several parents, left to right
D = C++ / D = A ++ B                unchanged

super::h()                          the parent layer's protected `h`
super[T]::h()                       parent T's layer (T a direct parent)
```

- `super::name` is dispatch within the same actor to the parent layer's definition, not a message to another actor.
- After `::` the name is written bare, as declared: `super::@a ` and `super::#c` are errors.
- Unqualified `super::h()` when more than one parent defines `h` is a compile error naming the candidates (`super[A]::h()` or `super[B]::h()`). No method resolution order.
- `super[S]` for a non-direct ancestor is an error for now.
- `super` and `super[T]` are valid only before `::` (and `.`, if adopted, below); `x = super` is an error. `super` becomes reserved, like `new`.

Retired, with errors pointing at the new form

- `(sup T ++)` and `(sa A ++ sb B ++)`: wrapped parents.
- `(T ++ u Text) *{ … }`: parent inside the params.
- `sup.a()` / any member access on the old wrapped local.

To confirm before implementing (discussed, not settled)

- `super.a()` as the spelling for the parent layer's public `@a `, so that `.` takes public names and `::` takes bare (protected) names everywhere. The alternative was `super::` for both, which needs a sigil after `::`.
- `super::total` on a cell: proposed as valid only in the child's redeclaration of `total`, meaning the parent's initializer (`total *Integer = super::total + 6`), and an error elsewhere.

Also update

- Service documents: `C (A ++ B ++ c: Integer) -> *{ … }` becomes the new form, and parseInterface reads it back.
- Tests in __tests__/classes/subclasses.test.js that use `(sup T ++)` / `(t T ++)`: rewrite them to `super::` (or `super.`, per the decision above); keep the behaviours they check. (__tests__/classes/wrapped.test.js covers `(inner *)` actor-ref params, a different feature.)
- notes/class-extends-plusplus-2026-11-10.md: mark its wrapped-parent section superseded.

Out of scope

- Remote parents (separate ticket).

Done when, on js, rust and erlang (no target skipped):

- The new forms parse and run. A subclass's override of a protected function is seen by the parent's code. `super::h()` from the override returns the parent's `h`. `super[T]::h()` selects among two parents.
- Each retired form and each error case above is a compile error with the stated message.
