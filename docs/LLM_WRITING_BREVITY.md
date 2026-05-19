# Writing Brevity Quickly

LLM orientation: this is the fastest path for generating current Brevity source.
Use this guide before reaching into design notes. If a detail is missing,
prefer the test-backed notes in [`__tests__/`](../__tests__/README.md).

## Mental Model

- A Brevity file is an actor.
- `@name` is a public message handler.
- Plain local functions are implementation helpers.
- `#name` is an explicitly private function.
- `*( ... ) =` at file top declares construction context and dependencies.
- `Name = *(...) { ... }` declares a class (constructs actors).
- `::Name = (...)` declares a type (constructs values).
- `*Type` marks a mutable cell or actor-shaped binding.
- `*Name(...)` constructs an actor of the named class.
- Replies are explicit structures.

For the runtime distinction between values and actors, see
[Values and Actors](./VALUES_AND_ACTORS.md).

## Handler Patterns

```brevity
@status = -> ok: "ready"

@echo = (:text Text) -> :text

@add
  =
  :a Integer
  :b Integer
  =
  sum Integer = a + b
  -> :sum
```

Use named params and named replies when possible. Keep multi-step handlers
lineal: params, then local work, then reply.

## State

```brevity
count *Integer = 0

@inc = {
  count <- count + 1
  -> value: count
}
```

`count` is an actor cell. The `*Integer` declares it as a mutable,
actor-shaped binding rather than a plain Integer value. Use `<-` for cell
mutation. Use `=` for binding. Pass a cell with `*name` when a function
parameter expects `*Type` (the call-site `*` grants write capability).

```brevity
@bump = {
  inc = (target *Integer) { target <- target + 1 }
  inc(*count)
  -> value: count
}
```

## Dependencies

Declare dependencies in the file header:

```brevity
*(
  "/services/store": (Store) {
    get: (:key Text) -> (:value Text)
    put: (:key Text, :value Text) -> .
  }
)
=

@fetch = (:key Text) {
  :value Text = Store.get(:key)
  -> :value
}

@save = (:key Text, :value Text) {
  Store.put(:key, :value) .
}
```

Silent methods return `.`. Replying methods bind their named reply fields.

## Remote Actors

`*Name(...)` constructs a remote actor, where `Name` is the local alias for a remote-declared class:

```brevity
*(
  "WebView": (WebView) *(:path Text) -> {
    open: () -> .
    close: () -> .
  }
)
=

view = *WebView(path: "/main")

@open = { view.open() . }
```

Use named arguments for remote actor construction unless the tests for a case
show a positional form.

## Shapes

```brevity
::Point = (x Integer, y Integer)

@make = -> point: Point(1, 2)

@x = {
  p Point = Point(3, 4)
  -> result: p.x as Integer
}
```

`Point(1, 2)` is a value. Shape field access on a value is local — not a CAM
round trip. `*Point(1, 2)` would produce an actor with the same shape; field
access on the actor would be a message send.

## Core Data Work

Use built-in methods through type calls, receiver calls, or bang cell calls:

```brevity
upper Text = Text.upper("hello")

name *Text = " ada "
clean Text = name.trim
name.trim!

items *(List of Integer) = [1, 2, 3]
items.append!(4)

payload Blob = Blob.from_hex("68656c6c6f")
```

Postfix `!` on a method call (`name.trim!`, `items.append!(...)`) is the
mutate-in-place form for actor cells — distinct from prefix `*`, which is the
actorize sigil on types and constructors.

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
- Use `-> .` or trailing `.` for silent operations.
- Use explicit local variables when reply typing matters.
- Treat design notes as context. Treat test-backed docs as current behavior.
