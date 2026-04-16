# Constructor Syntax Discussion — 2026-03-24

## The Problem

Brevity currently uses this pattern for actor/type definitions:

```
MyType = |a, b| {
  @method = {...}
  -> self
}
```

This has a fundamental ambiguity: `MyType(args)` looks identical whether MyType
is a constructor (creates a new actor context) or a private function (operates
in the current context and returns a value). The `-> self` is ambiguous — whose
self? The new actor's, or the caller's?

Most languages resolve this with `new` or `.new`. We wanted to resolve it in
the syntax itself.


## Angle Brackets as Constructor Syntax

The key insight: `< >` denotes constructor/type definition. It replaces `| |`
(which denotes functions). Same position in the syntax, different meaning.

```
f = |a| a + 1           // function
T = <a : Integer>       // type/constructor
```

The angle brackets CREATE a new self. This is what distinguishes a constructor
from a function — the `< >` is the boundary that establishes a new actor
context.


## What `< >` Means Precisely

Three distinct steps underlie the syntax:

1. `<x : Integer>` — a type definition. Not yet alive.
2. `<x : Integer>(100)` — instantiation. Now there's a self.
3. `<x : Integer>(100) |> |self| { body; self }` — pipe the live instance
   through an initializer that can add methods, state, etc.

The sugared forms collapse steps 2 and 3.


## Record Types (Params Only, No Body)

When `< >` contains only typed declarations, it's a complete record type.
Accessors are implicit.

Delimited:
```
Point = <x : Integer, y : Integer>
```

Lineal:
```
Point
  <
    x : Integer
    y : Integer
  >
```

Usage:
```
p = Point(3, 4)
p.x()    // 3
p.y()    // 4
```


## Types with Body

When behavior is needed beyond accessors, a body follows the params.

Delimited:
```
Custom = <x : Integer, y : Integer> { @sum = { x + y } }
```

Sugared (params and body together inside angles):
```
Custom = <
  x : Integer
  y : Integer
  @sum = { x + y }
>
```

In the sugared form, the parser distinguishes params from body by content:
bare typed declarations are params, `@`/`ref` declarations are body. An `=`
delimiter between sections is optional for readability, required when ambiguity
could arise.

Lineal:
```
Custom
  <
    x : Integer
    y : Integer
  >
  =
  @sum = { x + y }
  .
```

The `=` after `>` opens the body. `.` terminates it. The implicit `-> self`
is carried by the `.` — the actor was already created by `< >`, the body
just configured it, and `.` means "done, hand it back."


## No-Param Constructors

For actors with no constructor params (singletons, services, stateful widgets):

Delimited:
```
Service = <> { ref count : Integer = 0; @inc = { count <- count + 1; -> :count } }
```

Lineal:
```
Service
  <>
  =
  ref count : Integer = 0
  @inc = { count <- count + 1; -> :count }
  .
```

`<>` signals "this is a constructor" even with no params. The `=` after `<>`
is optional when there are no params (because there's nothing to delimit),
but we lean toward including it for consistency.


## Parameter Syntax Inside `< >`

Same conventions as function params:

```
<
  x : Integer            // required positional
  y? : Integer = 0       // optional positional with default
  :name : Text           // required named
  :label? : Text = ""    // optional named with default
>
```

`?` on the name marks optionality. `?` on the type means nullable (`Integer?`
= Integer | null). They are orthogonal.

A typed declaration with `=` but without `?` is a local variable, not a param:
```
<
  x : Integer           // param
  y? : Integer = 0      // optional param
  z : Integer = x + 1   // local var (has = without ?)
>
```


## Accessor Conventions

For `<a : Integer>`:
- Positional param `a` — accessor is `t.a()`

For `<:a : Integer>`:
- Named param `:a` — accessor is `t.a()`, constructed with `T(a: 42)`

For `<ext: int : Integer>`:
- Named param with key `ext` and binding `int`
- Accessor is `t.ext()` (public-facing key)
- Constructed with `T(ext: 42)`


## Types Are Actors

There is no separate type system. A "type" is just a constructor function that
returns an actor with an interface.

```
Counter = <start : Integer> {
  ref count : Integer = start
  @inc = { count <- count + 1; -> :count }
  @get = { :count }
}

c = Counter(0)
c.inc()   // 1
c.inc()   // 2
```

Immutable data is just an actor with no `ref` — closed-over params:
```
Point = <x : Integer, y : Integer>
```

Mutable state uses `ref` in the body:
```
Counter = <start : Integer> { ref count : Integer = start; ... }
```

The distinction between "type" and "actor" dissolves entirely.


## Inline Anonymous Actors

For one-off actors that don't need a reusable type:

```
panel = <> {
  ref volume : Integer = 50
  @set = |:v : Integer| volume <- v .
}
```

Or with params:
```
handler = <@event = |e| { process(e) }>
```


## Binding to External Actors

The `~` operator binds an actor as the interface for an external connection
(views, services, etc.):

```
view /panel as P
P ~ <@input = |:v : Integer| volume <- v .>
```

Or with a pre-declared interface:
```
listen = <@event = |e| { handle(e) }>
view /panel as P
P ~ listen
```

`~` reads as "linked to" / "associated with" — a bidirectional binding.
Messages flow both ways through the connection.


## View Declaration

```
view /cp as P

P ~ <
  @input = |:v : Integer| volume <- v .
  @closed = { cleanup() . }
>

@begin = { P.open() . }
```

`view` declares a connection to a UI resource. `P.open()` materializes it.
The `~ < >` block declares the actor interface exposed to the view.


## Options Considered and Rejected

**`-> self` as constructor signal**: Ambiguous — doesn't distinguish new context
from returning caller's self. This is the current syntax and the problem we're
solving.

**`end#Name` as terminator**: Works but introduces a new closing convention
that doesn't parallel anything else in the language.

**`self >` as closer**: Explicit but noisy. The self-return is always the same,
so it's boilerplate.

**`/>` (self-closing, XML-style)**: Unambiguous but visually heavy. Degrades
the reading experience.

**`<>` as open/close toggle** (`<> ... <>`): Workable but the double `<>` at
close doesn't signal "end" as clearly as `.` or `>`.

**`< ... >` for lineal body (everything inside angles)**: Tidy but ambiguous
about where params end and body begins without a delimiter.

**No angle brackets (just `{ self }`)**: Doesn't create a new context. `self`
refers to the caller, not a new actor. Fundamental ambiguity.

**`with`/`end#` blocks for binding**: Works but introduces new keywords for
something that `~` handles more concisely.

**`on CP` blocks for event handlers**: Replaced by `~ < >` binding syntax.


## Types Are Actors — No Separate Type System

There is no `type` keyword needed. A "type" is just a constructor that produces
an actor. Base types (Integer, Text, etc.) are actors too — dot methods are
message passing. The hierarchy of composed types is just a hierarchy of actor
processes.

This may be the most important insight from this discussion. The type system
IS the actor system.


## Binding Semantics: ref, permit, &

Three levels of access, each requiring explicit opt-in:

### `ref` — local mutation capability

```
ref fm = FileManager()
fm.add(file)              // ok — ref grants local effectful access
if cond fm.add(file)      // ok — child scopes inherit ref access
fn = |file| { fm.add(file) }  // ok — closures capture ref
```

`ref` means "this is a live actor with identity." You can send effectful
messages to it from your own scope and closures.

### `&` — pass without copying

```
peek(&fm)                 // read-only — fm is ref, not permit
```

`&` at the call site means "don't copy, share a reference." When the source
is `ref` (not `permit`), the receiver gets read-only access — they can call
operations that return values but cannot call effectful operations.

### `permit` — grant external mutation capability

```
ref fm = FileManager()
permit fm_write = fm

shuffle(&fm_write)        // effectful — permitted
```

`permit` creates a handle that, when passed with `&`, grants the receiver
full effectful access. It's a deliberate, visible escalation — "I authorize
external mutation through this handle."

Without `permit`, `&` is always read-only. This is the default safe path.

### The full picture

```
ref fm = FileManager()          // I can mutate
permit fm_write = fm            // others can mutate through this

peek(&fm)                       // read-only
shuffle(&fm_write)              // effectful — permitted

transform(fm)                   // copy — receiver gets their own
```

- No `&`, no `ref` → value copy, fully isolated
- `&` on `ref` → shared, read-only
- `&` on `permit` → shared, effectful
- `ref` without `&` → local mutation only

The compiler enforces these boundaries. Attempt an effectful call on a
read-only `&` → compile error.

### `&` in constructor params

`&` in a param declaration means "this is a reference to an external actor":

```
Observer = <&target : Counter> {
  @check = { target.get() }
}

ref c = Counter(0)
obs = Observer(&c)
```

Whether Observer can mutate `c` depends on whether a `ref` or `permit` handle
was passed.

### `ref` inside `< >` — mutable fields

`ref` inside a constructor's param list means the field is mutable state,
with implicit set accessors:

```
MutablePoint = <
  ref x : Integer
  ref y : Integer
>

p = MutablePoint(1, 2)
p.x <- 5              // ok — ref field has set accessor
```

Note: `ref` on the binding site (`ref p = Point(1, 2)`) promotes an immutable
type into a live actor with set accessors, without the type needing to declare
`ref` fields.


## Summary

- `< >` = constructor (creates new actor context)
- `| |` = function (operates in current context)
- `~` = bidirectional binding between actors
- `.` terminates service block (implicit self-return)
- `<>` = no-param constructor marker
- `ref` = local mutation capability
- `permit` = grants external mutation capability
- `&` = pass by reference (read-only unless `permit`)
- Types are actors. Everything is actors.
