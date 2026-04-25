# Type / Class Split — 2026-04-25

Design conversation. Substantial revision to Brevity's vocabulary and a new
first-class language construct.

Status: **decided**, not yet implemented. No tests yet.

---

## The naming decision: Types vs. Classes

Named actor constructors (`Counter = <start Integer> { ... }`) are henceforth
**Classes**, not Types.

The case for the switch:

- Named constructors have full class machinery: public/protected/private
  methods, inheritance (`<T | params>`), virtual dispatch, auto-accessors,
  mutable state cells. Calling them "Types" creates a bait-and-switch —
  especially for TypeScript developers where `type` specifically means a
  non-instantiable structural alias.
- `new` travels on the wire. `self` is a keyword. `super` is accomplished
  syntactically via `<T*|>`. The OOP plumbing exists, just slightly different.
- The design notes themselves reach for "class" when explaining the concept
  informally (`classes.js`, "reusable constructor/class"). The word does real
  communicative work.
- Scalars (`Integer`, `Text`, `Boolean`) are fundamentally immutable and carry
  no state. They ARE types in the normally understood sense. User-defined
  constructors are not the same kind of thing.
- "While it is true that even scalar values are queried by message, that is a
  property of their host actor, not of themselves." — scalars don't have
  independent actor identity.

The vocabulary now has a real distinction to fill: **Type** is reserved for
something different from Class (see below).

---

## What a Brevity Type is

A Type is a **portable data shape**. It describes the structure of a BV
Structure — a JSON-compatible record that can travel on the wire. Key
properties:

- **Homeless.** A class lives somewhere: it has an actor address, it is called
  by address, instances have addresses. A Type has no actor lifecycle. It has
  an *authority* definition address (a canonical location you can point at for
  verification), but the type itself travels — it exists wherever it is
  referenced, simultaneously, with no home.
- **Protocol, not program flow.** Every other keyword in Brevity is
  operational — things that happen at runtime (`spawn`, `emit`, `subscribe`,
  `ingest`). `type` doesn't happen. It declares something that exists at the
  protocol level, outside any execution context. This is a different register
  of the language, and it is correct that it feels different.
- **The type system and the wire format are the same concern.** A Type IS a
  BV Structure schema. Type-checking a value and validating a message payload
  are the same operation. This is a strong design property.

---

## Syntax

### The `type` keyword

`type` is in **value position** — the RHS of an assignment — consistent with
Brevity's pattern that the shape of the value determines what something is:

```brevity
f = |x Integer| x + 1        // function — pipes
Counter = <start Integer> {}  // class — angles
Point = type(x Integer, y Integer)  // type — type keyword
```

This keeps `Name = Value` intact. `type` in value position is the signal that
this particular thing is a homeless shape, not an actor.

Inline named declaration:
```brevity
Point = type(x Integer, y Integer)
```

Multiline delimited:
```brevity
Company = type(
  name Text
  address Text
  ranking Integer
)
```

Lineal:
```brevity
Point = type
  x Integer
  y Integer

```
(double-LF or dot terminated, per normal lineal rules)

File form (`Point.bv`) — filename is the name, so:
```brevity
type
  x Integer
  y Integer
```

No `Name =` prefix; the file IS the declaration. Parallel to how a class file
(`Counter.bv`) contains just `<start Integer> { ... }` without repeating the name.

### Why parens, not curly braces

Curly braces signal an execution context in Brevity — a closure, a service
block, something that runs. A Type has nothing to run. Using `{}` would import
a connotation that actively misleads.

Parens are lighter. They say "here is a list that defines a shape" without
implying anything executes.

`type(` cannot be confused with a function call because `type` is a reserved
keyword.

### Field declarations: `name: Text` not `:name Text`

Inside a type, fields use post-colon annotation syntax:

```brevity
Company = type(
  name: Text
  ranking: Integer
  address: (
    street: Text
    zip: Text
  )
)
```

The pre-sigil colon (`:name Text`) is load-bearing in param lists: it signals
a named parameter with a destructuring contract between caller and callee.
Type fields have no call site and no destructuring — they are declarations.
`name: Text` is correct: the colon is a type annotation separator, not a
named-param sigil.

The two colon conventions are now explicit and distinct:

```brevity
:name Text    // named param — colon prefix — destructuring contract
name: Text    // type field — colon postfix — field declaration
```

### Nested anonymous types

Inside a type declaration, nested `()` are implicitly type shapes — `type`
does not need to be repeated. Same logic as JSON: `{` at the top signals an
object; inner `{` are understood as objects without re-signaling.

```brevity
Company = type(
  name: Text
  address: (
    street: Text
    zip: Text
  )
  ranking: Integer
  leadership: (
    head: (
      name: Text
      title: Text
    )
  )
)
```

The recursion is natural. A Type is a specific, recursive shape of a BV
Structure — the syntax reflects this directly.

### Overloads

The standard overload operators apply:

```brevity
Point = type(x Integer, y Integer)
Point << type(:x Integer, :y Integer)
```

`=` creates the first shape; `<<` appends overloads. Whether overloads must
produce the same resulting interface is not yet decided. The union reading
(a `Point` can be either cartesian or polar) is valid and potentially useful
— BV Structure content-based dispatch handles it naturally.

---

## The bang operator extended: actorizing Types

`!` (the actorizing bang operator) now applies to Types as well as scalars:

```brevity
p = Point(1, 2)      // immutable value — travels as data, no actor lifecycle
p = Point!(1, 2)     // mutable cell — hosted, addressable, can receive messages
```

`!` means "give this thing an actor identity." The operation is consistent
whether the thing is a scalar (`Integer!`) or a structural type (`Point!`):
promote a homeless shape into a resident.

This makes previously implicit decisions explicit. In the old model, every
`Point` construction was silently an actor allocation. Now you opt in with `!`.
The default — `Point(1, 2)` — is lightweight, portable, wire-friendly. The
exception — `Point!(1, 2)` — is the heavier thing, and it shows.

Example in a service block:
```brevity
@p = Point!(1, 2)    // public mutable Point cell
```

---

## The Class / Type boundary, restated

| | Class | Type |
|---|---|---|
| Declared with | `Name = <params> { body }` | `Name = type(fields)` |
| Has actor lifecycle | yes | no |
| Has address | yes | authority address only |
| Instantiation | `Name(args)` → hosted actor | `Name(args)` → immutable value |
| Actorized form | already an actor | `Name!(args)` |
| Travels on wire | by address | by value (as BV Structure) |
| Can have methods | yes | no |
| Can be subclassed | yes | no (overloads only) |
| Scalars (`Integer` etc.) | no | yes (the canonical example) |

---

## Open question: interface field syntax

Interface documents currently use shorthand handler header syntax, which uses
the `:name Text` (pre-sigil) convention. Given that `name: Text` is now
established for field declarations in types, it is worth revisiting whether
interface field declarations should also switch to `name: Text`.

The argument: an interface describes the *shape* of messages an actor accepts —
a field declaration, not a destructuring specification. From the caller's
perspective, `@greet name: Text -> result: Text` would be consistent with the
type field convention.

The counter-argument: the handler on the other end IS destructuring — the
message arrives and named fields are pulled out. The pre-sigil colon marks the
destructuring contract correctly.

Not yet resolved.
