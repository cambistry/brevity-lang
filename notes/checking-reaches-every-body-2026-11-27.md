# Checking reaches every body — 2026-11-27

Decided with the user on 2026-11-27, across several tickets. A type known at compile time is
checked wherever the value is used, not only in a function body's top-level statements.

## A lambda takes its params' types from its slot

- Each untyped param takes the type its slot gives: each element in `over` and `List.sort`
  (`List.map`, `filter` and `find` are `over`); the seed and each element in `reduce`; the value a
  `sub` delivers from a cell; the subject piped into a clause list.
- An explicit param type the slot can't pass is an error: `'over' of List[Integer] passes 'x' an
  Integer, which isn't a Text`.
- The lambda's body is checked with those types and the names around it.
- Not yet: the result's type (`r = over(xs) …`), which is
  `an-unannotated-bind-infers-only-literals-and-own-calls`.

## Every block is checked as a body

An `if`'s branch (as a value or a statement), a loop's body and a clause list's clause are checked
as a function body is, with the names around them in scope. A clause's error names the binding as
written.

## Text and Blob functions, and arithmetic, check their operands

- A `Text.*` or `Blob.*` function takes its subject and its other args by type: an index is an
  Integer, a needle or a joined value is the subject's type. `Text.size(x)` checks its subject
  too. A literal takes the form its slot asks for (`Blob.first("hi")`).
- Arithmetic takes numbers. `+` also joins two Texts or two Lists. `Text - Text`, `Integer + Boolean`
  and `Text + Integer` are errors.
- An unknown type (`Anything`, a union, an unannotated name) is accepted.

## A typed local or cell takes only its class or a subclass

`p T = W(1)` is an error when `W` isn't `T` or a subclass, as for a param, and so is a cell's
declaration and every write to it (`*p <- v`, `notes/actor-pointers-2026-11-27.md`).

## `sub` on a cell the function declares is refused

Every write to such a cell happens while the function runs, where it can be acted on directly, so
a subscription has nothing to wait for. The error says so: `Cannot subscribe to 'n', a cell '@f'
declares: each write to it happens while '@f' runs, so act on the value where it's written`. The
same goes for a pointer the function declares and for a lambda in the function.

## Open

- The null rule (narrow before a call) covers pointers only:
  `a-call-through-a-name-that-may-be-null-is-guarded`.
