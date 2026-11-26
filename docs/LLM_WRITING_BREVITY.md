# Writing Brevity Quickly

LLM orientation: this is the fastest path for generating current Brevity source.
Use this guide before reaching into design notes. If a detail is missing,
prefer the test-backed notes in [`__tests__/`](../__tests__/README.md).

## Mental Model

- A Brevity file is an actor.
- `@name` is a public message handler.
- Plain local functions are implementation helpers.
- `#name` is an explicitly private function.
- `use` declares the file singleton's DI (dependencies and load-time params).
- `Name = (...) *{ ... }` declares an actor with a `new` (which builds actors). An actor is a
  value: `k = Name` holds its address, typed `Actor`; there is no `Class` type.
- `type Name (...)` declares a type (constructs values).
- `*Type` marks a mutable cell or actor-shaped binding.
- `*Name(...)` asks the named actor's `new` for an actor.
- Replies are explicit structures.

For the runtime distinction between values and actors, see
[Values and Actors](./VALUES_AND_ACTORS.md).

## Handler Patterns

```brevity
@status = -> ok: "ready"

@echo = (text: Text) -> :text

@add
  =
  a: Integer
  b: Integer
  =
  sum Integer = a + b
  return :sum
```

Use named params and named replies when possible. Keep multi-step handlers
lineal: params, then local work, then reply.

## State

```brevity
count *Integer = 0

@inc! = {
  count <- count + 1
  return value: count
}
```

`count` is an actor cell. The `*Integer` declares it as a mutable,
actor-shaped binding rather than a plain Integer value. Use `<-` for cell
mutation. Use `=` for binding. Pass a cell with `*name` when a function
parameter expects `*Type` (the call-site `*` grants write capability).
A function that writes is named `!` (see Effects below).

```brevity
count *Integer = 0

@bump! = {
  inc! = (target *Integer) { target <- target + 1 }
  inc!(*count)
  return value: count
}
```

## Effects

A name says whether its function writes, and the compiler checks it:

- **No mark** (`total`): read-only. Its tail expression is its value.
- **`!`** (`inc!`): writes. No tail return: falling off the end returns `self`, and
  `return v` returns `v`. A final value is an error, and so is mixing `return v` with
  falling off the end (write `return self`).
- **`.`** (`reset.`): silent, no reply. Call it with `...`.

```brevity
n *Integer = 0

@total = -> n
@inc! = (i Integer) { n <- n + i }
@take! = {
  v Integer = n
  n <- 0
  return v
}
@reset. = { n <- 0 }
```

Calling a `!` or `.` function is a write, so its caller needs a mark too. Writes that
don't count: cells local to the call, calls on an actor the function just made (if they
write only that actor), and anything `untracked` (logs, metrics, caches).

Signatures state the effect in the arrow, never the name: `->` reads, `=>` writes,
`~>` claims to read. `=> self` returns self, `=> .` is silent, and `-> self` is the
identity. These arrows appear in docs, function types and type fields only; a body's
arrow is always `->`.

Chains: `c.inc!(1).inc!(2).total()` works because each `!` link returns `c`. When a
link returns a value, as `take!` does, bind it first.

Details and every example, compiled: [Syntax Crib](./SYNTAX_CRIB.md), sections "Effects"
through "Chains".

## Dependencies

Declare dependencies with `use`:

```brevity
use Store = "/services/store" as {
  get (key: Text) -> (value: Text)
  put. (key: Text, value: Text) => .
}

@fetch = (key: Text) {
  :value Text = Store.get(:key)
  return :value
}

@save. = (key: Text, value: Text) {
  Store.put(:key, :value)...
}
```

Silent methods are named with a glued `.` and typed `=> .`; call them with a
trailing `...` (fire-and-forget). Replying methods bind their named reply fields.

## Remote Actors

`*Name(...)` constructs a remote actor, where `Name` is the local alias for a remote actor with a `new`:

```brevity
use WebView = "WebView" as (path: Text) -> *{
  open. () => .
  close. () => .
}

view = *WebView(path: "/main")

@open. = { view.open... }
```

Use named arguments for remote actor construction unless the tests for a case
show a positional form.

## Types

```brevity
type Point (Integer, Integer)
type Pair (x: Integer, y: Integer)

@make = -> point: Point(1, 2)

@first = {
  (a, b) = Point(3, 4)
  return result: a
}
@x = -> result: Pair(x: 3, y: 4).x
```

A positional field is a bare type, read only by positional destructuring. A
named field (`x: Integer`) is filled by name only (`Pair(x: 3, y: 4)`) and read
by name. `Point(1, 2)` is a value. Type field access on a value is local — not a CAM
round trip. `*Point(1, 2)` would produce an actor with the same shape; field
access on the actor would be a message send.

## Core Data Work

Use built-in methods through type calls, receiver calls, or bang cell calls:

```brevity
name *Text = " ada "
items *List of Integers = [1, 2, 3]

@go! = {
  upper Text = Text.upper("hello")
  clean Text = name.trim()
  payload Blob = Blob.from_hex("68656c6c6f")
  name.trim!()
  items.append!(4)
}
```

Postfix `!` on a method call (`name.trim!()`, `items.append!(...)`) is the
mutate-in-place form for actor cells, and a write like any other — distinct from
prefix `*`, which is the actorize sigil on types and constructors.

Core method references:

- [Core Type Methods](../__tests__/core_types/methods.md)
- [Text Methods](../__tests__/core_types/text_methods.md)
- [List Methods](../__tests__/core_types/list_methods.md)
- [Blob Methods](../__tests__/core_types/blob_methods.md)

## Browser and Markup

For browser examples, start with the tested browser and HTML/XML notes:

- [Browser Target](../__tests__/browser/index.md)
- [HTML / XML Surface](../__tests__/html/index.md)
- [XML Surface](../__tests__/xml/index.md)

## Generation Rules

- Prefer the simplest pattern already present in tests.
- Keep examples small and actor-centered.
- Do not invent method names; check the relevant method doc first.
- Name a function that writes with `!` (`save!`), and a silent one with a glued `.` (`save.`), typed `=> .` and called with `...`. A trailing `.` in a body is an error.
- In a `!` function, end with the write, or `return` the value; never a bare tail value.
- Reach a parent's definition with `base::h()` (protected) or `base.a()` (public), not `super.a()`. Don't name a cell, local, param or `use` binding `base`.
- A subclass with params of its own builds its base with `super(…)` in the constructor block, once, passing what the parent needs: `U = T ^ (label Text, n Integer) *{ super(n) … }`. Bare `super` passes the args as received; `super()` none; `super[A](…)` per parent when there are several. Don't read a parent's cell above the `super` line. Leave `super` out only to re-implement the parent's whole public interface without its state.
- In an override, `super` calls the parent's same function: bare `super` with the args as received, `super(…)` with others, `super()` with none. With several parents, `super[A](…)`. In a class block that extends its parent's, `super` is the parent block's same function.
- `class::base` is the running class's parent: `class::base::h()`, `class::base.f()`, `class::base(…)`. With several parents, name the parent instead.
- Use explicit local variables when reply typing matters.
- Treat design notes as context. Treat test-backed docs as current behavior.
