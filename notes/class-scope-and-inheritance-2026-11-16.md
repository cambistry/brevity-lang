# Class scope, member access and inheritance — 2026-11-16

Records a long design discussion. Each section says whether it is **decided**, **direction**
(agreed in principle, details open) or **open**. Not implemented unless stated elsewhere.

Companions: `private-names-lexical-2026-11-16.md` (what `#` reaches) and
`remote-superclass-2026-11-16.md` (inheritance across files and trust boundaries).
Supersedes parts of `class-singleton-forms-2026-11-13.md`,
`classes-as-singletons-2026-11-09.md` and `class-extends-plusplus-2026-11-10.md`, as marked
there.

## Two mechanisms: closure and qualified access — decided

A name is reached in one of two ways, and they don't mix.

- **Closure: a bare name, with its sigil (`@x`, `x`, `#x`).** It reaches what is lexically
  in scope, plus the actor's own names, including names it has through merged inheritance.
  It never reaches into another actor that doesn't enclose it in the source.
- **Qualified access: through `.` or `::`.** It reaches another actor's members, or another
  layer of this one. It is the same whatever the nesting.

**Sigils are lexical labels, never part of an address.** `@x`, bare `x` and `#x` are how a
name is written where it's in scope. After a dot or `::`, no sigil is written.

## `.` and `::` — decided

| After | Takes | Reaches | Mechanism |
|---|---|---|---|
| `.` | a public member's wire name | public members | a message |
| `::` | a bare name, as declared | types, and protected members | static: a qualified name in that actor's scope |

- `X.@a`, `X.#a`, `X::@a` and `X::#a` are errors.
- `X::count` when `X` declares only `@count` is an error: "'count' is public: write
  `X.count`". `count` and `@count` are distinct labels, so the bare token after `::` always
  names the protected one.
- `X::name` is never ambiguous between a type and a member: a type name in scope is
  reserved.
- Private names are never reached through `.` or `::`.
- `C::name` is allowed only within `C`'s family: `C`'s own actors and its subclasses' actors.

This replaces two earlier ideas: `.~name` for protected access, and letting `C.x` fall back
to a protected `x`.

## `class` — decided 2026-11-17

`class` is the class of the running actor.

```brevity
class.count            // public member of my class's class block
class::total           // protected member of my class's class block
class.count <- 1       // `$set` of a public `*` cell; `class::total <- 1` of a protected one
class(args)            // construct, as C(args) does
k = class              // the class itself, as `k = C` (a class as a value isn't supported yet)
```

- **Reserved**, not contextual as `actor` is: `class = …`, `class *Integer = …` and a param
  named `class` are errors. A member may have the name (`@class`, `k.class()`), and so may an
  XML attribute (`<Box class="a" />`).
- **As a receiver, `class` is the class whose block the code reaches:** its own, or, for a
  subclass with no block of its own, its nearest parent's (the delegated rule below). It's
  resolved statically from the text, so `T`'s code run by a `U` actor still means `T`. The
  late-bound reading (`T`'s code using `U`'s redeclared cell) waits for class-block delegation.
- **Elsewhere, `class` is the running class itself** (`class(args)` builds a `U` in `U`).
- **Where no class built the running actor** (a class block, a singleton, the file), `class`
  is an error.
- `Self` is unchanged for now.

Open:
- how `class` relates to the existing `Self` (the file's class).

## `x::class` — decided 2026-11-17

`x::class` is the class of actor `x`, and `class` is shorthand for `self::class`, so the
bare word reads as `self` does: an implicit receiver, not a separate concept. `class_of` is
retired outright (`class_of(…)` is an error naming `x::class`).

- **Unambiguous:** `class` is reserved, so no member or type can be named `class`, and
  `x::class` can't collide with `x::name` — the reasoning that keeps `X::name` unambiguous
  for types.
- **`::`, not `.`:** `.` sends a message by wire name, so `x.class` would ask `x` and let
  the actor answer for itself. `::` is a name in that actor's scope, as declared; an
  actor's class is a fact about its reference (its `ty`), not something it decides.
- **It chains:** `x::class::total`, `x::class.count`, `x::class::Point`, read left to right.
- Precedent: Kotlin's `x::class` / `String::class`, PHP's `Foo::class`.

Implemented: `self::class`, everywhere `class` is valid (it is the same thing). `x::class`
for any other `x` is an error, "not supported yet": it needs the class from the actor's
`ty` at run time (see "`x::class` on another actor" under open questions).

## The class block and its actors — decided

- **Nested form** (`C = actor { … new = (p) *{ … } }`): the constructor is lexically inside the
  block, so it closes over every block name, private ones included.
- **Trailing form, and any `++` composition:** the constructor isn't inside the block, so no
  bare name reaches it. Instances use `class.pub` / `class::prot` (or `C.` / `C::`). This
  settles the "A vs B" question: no bare access across a boundary that isn't lexical.

Rationale: protected exists so a class's family can share internals without publishing
them, and a class's instances are family. They get that through qualified access, not by
having the block's names silently join their namespace. Taking the names on would shadow
the enclosing scope, and adding a member to the block could change what a trailing
constructor's bare names mean.

## `@` is lexical — decided

A class block's `@config` is reached bare from the nested `new` (closure), as `C.config` or
`class.config` from anywhere allowed, and never as `C.@config`. The Ruby-style alternative,
in which `@x` never leaves its own actor, was rejected:
- it would make private names reach further inward than public ones;
- it brings in Ruby's class-level vs instance `@x` confusion;
- it makes `@` depend on which actor runs the code rather than on the text.

## Inheritance is merged and late-bound — decided

- A plain `++` subclass and its parent are one actor. The parent's names are the
  subclass's own, so it reaches them bare.
- A subclass may override a parent's protected (or public) function and redeclare a
  parent's cell. **The parent's own code uses the override**, constructor block included.
  This is the template-method pattern, and it's essential.
- Today's implementation already does this for plain subclasses. The wrapped form doesn't:
  it builds the parent as a separate actor and loses late binding. The form is being
  retired.
- Private names don't take part: a subclass can't see the parent's `#x`, so a `#x` in the
  subclass is unrelated to it.

## Parent outside the params; `super` — decided 2026-11-17

The wrapped `(sup T ++)` form is retired. Its local `sup` was the only reason the parent sat
in the param list.

```brevity
U = T ++ (u Text) *{ … }
U = A ++ B ++ (u Text) *{ … }
U = T ++ *{ … }                      // no params; `(T++) *{ … }` is retired too

super::h()           // the parent layer's protected h
super.a()            // the parent layer's public @a
super[T]::h()        // parent T's layer
super::total         // the parent layer's own cell (below)
```

- `super::h()` is dispatch within the same actor to the parent layer's definition, not a
  message. `.` takes public names and `::` bare (protected) ones, as for `C.` / `C::` /
  `class.` / `class::`. `super.a` with no parens is a call, as `x.a` is a message.
- After `::` or `.` the name is written bare: `super::@a` and `super::#c` are errors.
- An unqualified `super::h()` with more than one parent defining `h` is a compile error
  naming the candidates (`super[A]::h()` or `super[B]::h()`). There is no method
  resolution order.
- `super[S]` is restricted to direct parents for now.
- `super` is reserved, and is valid only before `::` or `.`: `x = super` is an error.
- `T::h` names `T`'s class block, not a layer, which is why the layer needs `super[T]`.
- Each retired form (`(sup T ++)`, `(sa A ++ sb B ++)`, `(T ++ u Text)`, `(T++)`,
  `(A ++ B)`) is an error that names the new form. `(x Integer ++ …)` has the wrapped shape;
  when `Integer` isn't a class, the error says to separate params with commas.
- Service documents: `C A ++ B ++ (c: Integer) -> *{ … }`, `Text Node ++ -> *{}`.

### `super::total` on a cell

Valid anywhere in the child's scope, construction included, for reading and writing.

- A redeclared cell is late-bound: the parent's own code uses the child's `total`. So when
  a class at or below the child redeclares `total`, the parent layer keeps a cell of its
  own behind it, initialized by the parent's initializer, where the parent's
  initialization runs. `super::total` reads and writes that cell; the parent's code never
  sees it.
- When nothing below the parent redeclares `total`, there is one cell, and
  `super::total` is it.
- Which case applies depends on the actor's class, not on the code: `U`'s
  `super::total` is a cell of its own in a `U` that redeclares `total`, and in a `V`
  that extends `U`.

```brevity
T = *{ total *Integer = 5 }
U = T ++ *{
  total *Integer = super::total + 6        // 11; the parent layer's cell is 5
  @bumpParent! = { super::total <- super::total + 100 }
}
```

Open:
- The type rules for a redeclared cell. Proposed: a `*` cell keeps its type exactly, a
  constant may narrow, and a redeclaration may omit the type. Being explored separately.
- `super` in a class block (a class's members): an error for now, since a class block has
  no parent layer of its own.

## Class blocks inherit by delegation — decided

When `U` extends `T`, and `T` has a class block:

- **A cell belongs to the block that declares it.** If `U`'s block doesn't redeclare
  `count`, `U` uses `T`'s cell: one cell, so a change made through `T::count` is seen
  through `U`.
- **A redeclaration overrides, late-bound.** If `U`'s block redeclares `count`, `U` has its
  own cell. `T`'s code running for `U` (`class::count` in `T`'s constructor, or an inherited
  block function) uses `U`'s.
- **Writes never create a cell; only a declaration does.** That avoids Python's
  copy-on-write trap.
- **Functions layer and are late-bound,** as for instances.
- `class::` follows the running class, and `T::` names `T`'s block. Code can therefore
  choose per-class or shared state at the point of use.

Alternatives considered:
- **Copied** (each subclass's block gets its own copy, as in Smalltalk's class-instance
  variables). Rejected: a change to `T`'s cell isn't seen by `U`, and `T`'s block
  initializers run again for every subclass.
- **Shared with hiding** (Java `static`). Rejected: a redeclaration hides instead of
  overriding, so the parent's code keeps using the parent's cell.

Delegated differs from shared only when a subclass redeclares the cell. Instance cells have
no live parent actor to delegate to, which is why instances merge and class blocks
delegate.

## `++` composes class pieces — direction

`++` joins pieces in any order: named classes, anonymous constructors (`(p) *{ }`) and
class blocks (`actor { }`).

```brevity
U = T ++ (u Text) *{ … } ++ actor { … }
U = T ++ actor { … } ++ (u Text) *{ … }
```

- **Order never changes visibility.** No piece is inside another, so every arrangement has
  trailing-form scope. The nested form stays the only one that closes over a class block.
- **Order sets override precedence,** left to right, with later pieces winning.
- A class's own `actor { }` pieces merge into its one class block. A parent's block is a parent
  layer under the delegated rule.

- **`++` is required between a constructor and a class block** (decided 2026-11-17): the
  trailing form is `(p) *{ } ++ actor { }`, and the bare `} **{` juxtaposition is retired.
  See `actor-literal-2026-11-17.md`.

Open:
- whether a class may have more than one constructor piece;
- the param list a composed class takes;
- a lineal form.

## Types — decided

- A type is always public and takes no `@`. A type is part of a value's wire identity, and
  a receiver that couldn't name it couldn't interpret the value. A protected type would
  force a rename the first time it's sent.
- `type #T`, a local convenience type, is deferred. When it comes, its values may not leave
  the lexical region where it's declared: that region includes inner classes and the nested
  `new`, and excludes anything else, public signatures included.

## Open, with no other home

- **Atomic read-modify-write** on another actor's cell (`class::total <- class::total + 1`
  is two messages). Being explored separately; related to Opre op chains and call-scoped
  turns.
- **`x::class` on another actor:** the class of an actor other than self, presumably from
  its `ty` at run time; then `x::class.count` reaches that class's block.
- **Development order:** whether the remote-superclass message model should be settled
  first, since class-block delegation is already cross-actor inside one process. Discuss
  before drafting a spec.
