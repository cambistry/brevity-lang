# `++` is the extends operator — 2026-11-10

Replaces the subclass bar `|` (and the comma list of parents before it) in
class headers and service documents. `|` now means union only.

## Grammar

```
D = (C ++ x: Integer, y Text) *{ … }   parent, then a regular param list
D = (A ++ B ++ c: Integer) *{ … }      multiple parents; later parent wins
D = (C++) *{ … }                       parent, no params
D = (A ++ B) *{ … }                    two parents, no params
D = C ++ *{ … }                        no params: parens drop, as in C = *{ … }
D = C++                                pure subclass: a new class, no changes
D = A ++ B                             pure subclass of two parents
D = (sup C ++ x: Integer) *{ … }       wrapped: `sup` is a local of the parent's type
D = (sa A ++ sb B ++) *{ … }           each parent wrapped
Text (Node++) -> *{}                   service document
C (A ++ B ++ c: Integer) -> *{ … }     service document
```

Space around `++` is optional everywhere.

## Why `++`, not `+`

Expressivity, not parsing. Doubled glyphs in Brevity mark operations on
definitions rather than values: `::` (type level), `<<` / `>>` (add clauses
to a name), `--` / `---` (source structure). `++` joins that family: it
composes classes. A single `+` stays arithmetic on values; there is no
overload of `+` on classes. Inheritance mints a new identity, couples to every
parent's internals and, with several parents, is order-sensitive — the
operator is deliberately loud.

`D = C++` and `D = C` differ in kind: `D = C` is an alias (same class); `D = C++`
is a new class with its own authority / `ty` tag.

## Parents vs params

Read left to right. A segment is a parent while it is `B` or `sup B` (wrapped) and is
followed by `++`, or is a bare `B` right before `)` (classes take no bare
params, so a lone name there can only be a parent). The first segment that
isn't one starts the param list, which is the ordinary comma-separated list.
A literal "after the last `+`" rule would break on expression defaults; class
param defaults take only literals today, but left-to-right reading stays sound
if they grow expressions (a default's `+` follows `=` and never qualifies).

Wrapped `sup B` and a positional param `b Box` are the same token shape; position
decides. `(A ++ b Box)` is a param; a wrapped parent must be followed by `++`:
`(A ++ sup B ++)`. Capitalization plays no part.

A parent must be a class: local, or a constructor in a dependency's interface
(`Element` from the HTML manifest). A type — built-in (`Integer`) or custom
(`::Point`) — is "a type, not a class"; any other name is "not a class in
scope". Neither is silently dropped. `(A ++ x Integer ++ y Integer)` (params
joined by `++`) parses as wrapped parents and fails on that check; the
diagnostic says to separate params with commas.

## Wrapped parents

`sup B` replaces the `B *sup` wrap marker; the parent is still "wrapped". It has the shape of a positional
param — "a local `sup`, typed `B`" — in line with Brevity args, destructuring
and DI. There is no shorthand that binds the parent under its own name: the
old `(T* |)` (sugar for `T *T`) is retired, and `(:B ++)` is not offered —
both would shadow the class with the actor.

A wrapped parent needs a body to reference its local: `D = sup A ++ B` and `(sup A ++) *{}`
are errors.

## Retired forms

`(T | …)`, `(T, U | …)`, `(T *name | …)`, `(T* | …)` in class headers and
service documents report a retired-form error pointing at `++`.

## Out of scope

- Lineal class headers (no extends spelling exists today; one sketch: `++`
  alone on a line between parent and params — note its visual closeness to
  the `--` stitch, which carries no meaning).
- Diamond inheritance (one grandparent through two parents).
