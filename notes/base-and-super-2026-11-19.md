# `base` is the parent layer; `super` is held for later — 2026-11-19

Decided in discussion. Renames the `super` of `class-scope-and-inheritance-2026-11-16.md`
("Parent outside the params; `super`", decided 2026-11-17). Everything that section decides
stands, under the new word.

## The rename

The parent layer is `base`, as in C#:

```brevity
base::h()            // the parent layer's protected h
base.a()             // the parent layer's public @a
base[T]::h()         // parent T's layer
base::total          // the parent layer's own cell
```

- Same meaning as before: dispatch within the same actor to the parent layer's definition.
  `.` takes public names, `::` bare ones; after either the name is written bare.
- An unqualified `base::h()` with more than one parent defining `h` is a compile error naming
  `base[A]::h()` / `base[B]::h()`. `base[S]` is for direct parents only, for now.
- `base` is reserved and valid only before `::`, `.` or `[`: `x = base` is an error, and so
  are declaring or setting it (`base = …`, `(base Integer)`, `base <- …`).
- As a member name it is free, as `super` was: `@base = { … }`, `Slot.base`, `@Starred.base`,
  and a named field or key `base: 10`.

## `super` is reserved, with no meaning yet

`super` is held for a later decision: the parent's implementation of the current function
(`@x = { super(…) + 1 }`). Until then it's a reserved word with no form, so `super.x`,
`super::x` and `super` fail as any unexpected token does. No detector names `base`.

When `super` gets its meaning, it should be ungrammatical before `.` and `::`. Java, Python and
LLMs read `super.x` as the layer, which `base.x` now is; under a `super` that is a value,
`super.x` would otherwise parse as a member of it.

Open for that work, not decided here:
- In a lambda inside `@x`: `@x`'s parent (lexical, as `#` names are), or an error?
- With overload clauses (`<<`): the parent layer's clauses, or the next clause?
- Bare `super`: the current args again, or must they be written?
- Several parents defining `x`: `super[A](…)`, parallel to `base[A]`.
- A cell: `total Integer = super + 1` as the parent's initializer? (Otherwise `base::total`.)
- In `new`, `super(…)` would run the parent's `new` on this actor, which is Java's
  constructor chaining. That is the opposite of constructing a separate parent actor.

## Not adopted: `class::base()`

Proposed as "construct a superclass instance". Left out:
- `base::h` is the parent layer (this actor). `class::` reaches the class block, so
  `class::base` would be the parent class, a constructor of separate actors, and
  `class::base::h` (by `T::h` naming T's class block) the parent's class block. Two different
  things a letter apart.
- With several parents it needs `class::base[A]()`, which is `A()`.
- Close to `super(…)` in `new` (above), with the opposite effect.

It may earn a place where the parent has no name to write; decide it then.

## Cost

`base` is a plausible name where `super` wasn't. A cell, local, param or `use` binding named
`base` is now an error, and has to be renamed.
