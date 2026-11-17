# Private names are lexical — 2026-11-16

Decided. Settles what a `#` name reaches, for functions, constants and cells. Builds on
`at-sigil-internal-and-quoted-names-2026-11-12.md` (wire names) and
`class-singleton-forms-2026-11-13.md` (nested and trailing class blocks).

## The rule

A `#` name is visible in the scope that declares it and in every scope lexically inside it:

- the declaring actor's handlers and constructor block, and the closures and lambdas in them;
- a class declared inside it, at any depth, and that class's closures;
- in a class block, the nested `new`'s constructor, its methods and their closures.

It is never visible:

- to a subclass;
- through an address: `x.#y` and `class_of(self).#y` are compile errors, inside the class too;
- to the trailing constructor of a class block (`(p) *{ } ++ actor { #x … }`), which isn't inside the
  block's braces.

A `#g` declared inside a function is scoped to that function and what's lexically inside it.

## Why lexical

- **It's the flow of every mainstream language.** No mainstream functional language hides a
  binding from its own inner scopes; privacy there is a module-boundary matter. Java, Kotlin, Scala
  and C# let a nested or inner class see its enclosing class's `private` members.
- **Single-scope was considered and rejected.** The case for it was actor-shaped: an inner class is
  another actor, so its access to `#x` is a message, and its writes arrive from outside the owner.
  But that holds for every enclosing name an inner class reaches, protected ones included, and the
  rules already cover it (below). It isn't specific to `#`.

## `#` and `~` follow different axes

| Sigil | Source | Wire | Reaches |
|---|---|---|---|
| `@x` | `@x` | `x` | anyone |
| bare `x` | `x` | `~x` | the class and its subclasses (inheritance) |
| `#x` | `#x` | `#x` | the declaring scope and what's lexically inside it (text) |

Protected reaches subclasses, which are not lexically inside. Private reaches inner classes, which a
subclass is not. Neither contains the other.

## Forms

Every form that has a public or protected spelling has a private one, in the same places (file,
class, class block, function body):

```brevity
#f = (n Integer) -> n + 1     // function
#x = 3                        // constant
#n *Integer = 0               // cell
#t Integer = 3                // typed constant
```

`#x = 3` is a constant, not a function: the right side decides, as it does for `x = 3`.

## Interaction

From an inner scope, a `#` name works as an enclosing name of any other visibility does:

- **Read:** a message to the owner, seeing the value as it is at the time
  (`session-2026-11-03-class-reads-file-cells.md`).
- **Write:** `#n <- #n + 1` is a `$set` to the owner's cell. Only a `*` cell can be set.
- **Call:** `#f(…)` is a message to the owner.
- **Subscribe:** as for a protected cell.

## On the wire

A private name is never addressable. An inner actor reaches it over the parent-to-child channel the
enclosing-read mechanism already uses, never as a message anyone could address. The owner answers a
`#` name only to scopes lexically inside it. Nothing outside the declaring scope can name it, so
there is no access check to get wrong.

## Not changed

- The trailing class form's constructor reaches the class's members by address only
  (`class_of(self).count`). Private members are never addressable, so it never reaches them.
  Whether it gets public and protected members bare is the separate A/B question.
- `new` stays reserved; `#new` is not a spelling of it.
