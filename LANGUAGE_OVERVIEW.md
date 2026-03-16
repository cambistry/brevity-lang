# Brevity Language Overview

Brevity is a constrained, statically-typed language for defining actors in a distributed message-passing system. It is not a general-purpose language. It answers one question precisely: *given a typed message, what happens?*

---

## Philosophy

Most actor frameworks ask you to write general-purpose code that happens to run inside an actor. Brevity inverts this. The actor is the entire unit of expression — the file is the actor, handlers are its public surface, and everything else is local to a single message dispatch.

This constraint is intentional. Brevity trades flexibility for determinism. Because every handler declares exactly what types it accepts and what types it returns, the runtime can dispatch messages by type signature alone, without runtime introspection or convention. A message either matches a handler or it doesn't; the result is always a typed structure or an explicit error.

The type system and the authorization model are the same concern. Types describe message shapes, not object hierarchies. A `Signed of Person` is not a wrapper around `Person` — it is a different capability entirely, and the type boundary enforces that.

---

## Syntax

Brevity has two freely mixable syntax forms.

**Dense form** uses parentheses for argument lists and curly braces for blocks:

```
on greet(:name : Text) reply(msg: "hello, " + name : Text)
```

**Spacious form** drops parentheses and uses blank lines as block delimiters:

```
on greet
  :name : Text

  msg : Text = "hello, " + name
  reply
    msg: msg : Text
```

Both forms produce identical ASTs. You can mix them within a single file — a handler header in spacious form with a dense reply, or dense params with an open body. The `--` stitch (a bare double-dash on its own line) acts as a visual separator that carries no semantic weight, keeping spacious blocks continuous across what would otherwise look like a break.

**Comments:**

```
// This is a line comment
//
// A bare // on its own line is a block divider (stitch)

-- This is also a line comment
--
-- A bare -- is also a stitch

---
Everything between triple-dash lines
is a block comment.
---
```

---

## Actors and Handlers

A Brevity file defines an actor. Handlers are declared at the top level with `on`:

```
on ping()
  reply(status: "ok" : Text)
```

Handlers receive typed messages. Params can be positional, named, or mixed:

```
on add(a : Integer, b : Integer)
  result : Integer = a + b
  reply(result : Integer)

on tag(:item : Text, :label : Text)
  reply(tagged: item + ":" + label : Text)

on mash(a : Integer, :name : Text)
  reply(a : Integer, name: name : Text)
```

A handler that should not reply is terminated with `.`:

```
on log(:msg : Text) .
```

**Overloading.** Multiple handlers can share an op name. The runtime dispatches to the first one whose type signature matches the incoming `bv-a` (type annotation vector). This is pattern matching on message types, Elixir-style:

```
on format(value : Integer)
  reply(out: "int:" + value : Text)

on format(value : Text)
  reply(out: "text:" + value : Text)
```

**Rest params.** `...args` matches any payload unconditionally, accepting the whole structure:

```
on import(...args)
  reply(...args)
```

---

## The Type System

### Annotations

Types are annotated with `:`. Every locally-declared variable requires a type, either on the left-hand side or the right-hand side of the assignment — or both:

```
x : Integer = 5
y = 5 : Integer
z : Integer = 5 : Integer
```

Literals carry inferred types when assigned directly, so `x = 42` infers `Integer`, `x = "hi"` infers `Text`, `x = true` infers `Boolean`, `x = 3.14` infers `Decimal`, and `x = null` infers `null`. Binary expressions (`a + b`) require an explicit annotation.

A bare declaration with no initializer is valid:

```
count : Integer
```

### Base Types

| Type | Values |
|------|--------|
| `Integer` | Whole numbers: `42`, `-7` |
| `Decimal` | Fixed-point: `3.14`, `0.5` |
| `Float` | Scientific notation: `1.23E+2` |
| `Text` | String literals: `"hello"` |
| `Boolean` | `true`, `false` |
| `null` | The null literal |
| `Callable` | Any function or proc reference |

### Nullable and Union Types

```
result : Integer | null = if condition { 5 : Integer } else { null }
```

An `if` without an `else` branch returns `Type | null` — the compiler enforces this:

```
x : Integer | null = if flag { 42 : Integer }
```

### List Types

```
nums : List of Integers = [1, 2, 3] : List of Integers
words : List of Texts = ["a", "b"] : List of Texts
mixed : List of Anything = [1, "two", true] : List of Anything
```

### Callable Types

A fully-specified callable type describes its signature:

```
transform : (Integer) -> (Integer) = (x : Integer) x * 2 : Integer
```

The umbrella type `Callable` accepts any function without signature checking:

```
fn : Callable = (x : Integer) x + 1
```

### Type-Based Dispatch

The runtime uses `bv-a` — a type schema transmitted alongside every message — to select which handler runs. An incoming message carries its type annotations, and the handler whose param types match wins. This is how overloading works: it is not duck typing or runtime instanceof checks, it is exact type matching on declared schemas.

---

## Procs

Procs are internal callable units — subroutines that can be called from handlers and from other procs, but are never exposed as message endpoints.

```
proc square(n : Integer)
  sq : Integer = n * n
  reply(sq : Integer)
```

Calling a proc uses destructuring to receive its result:

```
on compute(x : Integer)
  result: sq : Integer = square(x)
  reply(:sq)
```

Procs can be passed as callables using `&`:

```
on apply(n : Integer)
  result : Integer = map(n, &square)
  reply(:result)
```

Procs may be defined before or after the handlers that reference them.

---

## Data: Structures and Lists

**Structure** is the primary data container. It holds positional and named fields:

```
s : Structure = Structure(1 : Integer, name: "Alice" : Text)
```

Destructuring extracts fields:

```
a, b = s                     // positional
:name, :age = person         // named
a: x = s                     // key 'a' → local 'x'
```

Discard with `_`:

```
_, b = pair
:name, _ = record
```

**Lists** are cons-cell linked lists. Destructuring into head and tail:

```
[head : Integer, ...tail] = nums
```

---

## Functions

Function literals use parentheses for params and either a block `{ }` or a single expression:

```
double = (x : Integer) x * 2
add    = (a : Integer, b : Integer) { a + b } : Integer
```

Named params use sigils:

```
greet = (:first : Text, :last : Text) { first + " " + last } : Text
```

Functions are closures — they capture variables from their enclosing scope. Outer variables may be shadowed but not reassigned from inside a function.

**Higher-order functions.** Functions and procs can be passed as arguments:

```
on transform(n : Integer)
  apply = (n, f) { r : Integer = f(n) }
  result : Integer = apply(n, (x : Integer) x * 3)
  reply(:result)
```

Pass a local function by reference with `&`:

```
double = (x : Integer) x * 2
result : Integer = apply(5, &double)
```

---

## Control Flow

### If / Else

```
label : Text = if score > 90 {
  "A" : Text
} else if score > 80 {
  "B" : Text
} else {
  "C" : Text
}
```

Inline form:

```
sign : Text = if n > 0 "positive" : Text else "non-positive" : Text
```

Only `false` and `null` are falsy; zero is truthy.

### Over (Map)

```
doubled : List of Integers = over nums (x : Integer) { x * 2 } : Integer
```

### reduce (Reduce)

```
total : Integer = reduce(0) nums (acc : Integer, item : Integer) {
  return acc + item : Integer
} : Integer
```

Without an initial value, reduce returns `Type | null` (null if the list is empty):

```
first : Integer | null = reduce nums (acc : Integer, item : Integer) {
  return acc : Integer
} : Integer
```

---

## Reply

Every handler that is not silent (`.`) produces a reply. The reply is the structured result sent back to the caller:

```
reply(x : Integer, y : Integer)            // two positional fields
reply(name: "Alice" : Text, age: 30 : Integer)  // two named fields
reply(:x, :y)                              // sigil shorthand: field name = variable name
reply(...result)                           // spread: forward a structure's contents
```

The runtime sends reply values back to the originating caller along with a type schema (`bv-a`) describing the result types, so the caller can dispatch on them in turn.

---

## Code Organization

A minimal Brevity file needs no boilerplate. The file is the actor:

```
on hello()
  reply(greeting: "world" : Text)
```

Named actor classes can be declared explicitly when multiple actor types are needed in one file:

```
actor Counter
  on increment(:count : Integer)
    next : Integer = count + 1
    reply(:next)

  on reset()
    reply(count: 0 : Integer)
end#Counter
```

Procs live at the top level alongside handlers. Definition order does not matter — a handler may reference a proc defined later in the file.

---

## Use Cases

**API layer actors.** A Brevity actor sitting at an HTTP boundary receives typed requests and routes to internal procs, sending structured replies. The type-dispatch model makes it straightforward to version APIs: add a new handler with a different type signature, and old clients continue hitting the old one.

**Data transformation pipelines.** `over` and `reduce` with typed callbacks make map/reduce pipelines readable and type-checked. The callback's return type is enforced, so the resulting list's type is known at compile time.

**Authorization boundaries.** Because types like `Signed of Request` and bare `Request` are distinct dispatch targets, authorization checks are structural rather than conditional. A handler that accepts `Signed of Request` literally cannot be called with an unsigned message — the type doesn't match.

**Composable proc libraries.** Procs with `Callable`-typed parameters enable higher-order patterns within a single actor — passing transformation functions, strategy callbacks, or lazily-evaluated computations without any of the overhead of cross-actor messaging.

---

## Compilation

Brevity compiles to ES module JavaScript. Each actor becomes an async class. Handler bodies become async methods. The `Structure` runtime object manages positional/named field packing and unpacking. Lists compile to head-tail cons cells with a helper library for map/reduce operations.

The compiled output is self-contained: no Brevity runtime is required beyond the small preamble embedded in each output file.
