# Writing Brevity Quickly

LLM orientation: this is the fastest path for generating current Brevity source.
Use this guide before reaching into design notes. If a detail is missing,
prefer the test-backed notes in [`__tests__/`](../__tests__/README.md).

## Mental Model

- A Brevity file is an actor.
- `@name` is a public message handler.
- Plain local functions are implementation helpers.
- `#name` is an explicitly private function.
- `< ... > =` at file top declares construction context and dependencies.
- `Type!` marks a mutable state cell or actor-like identity.
- `Name!(...)` creates a messageable remote instance.
- Replies are explicit structures.

## Handler Patterns

```brevity
@status = -> ok: "ready"

@echo = |:text Text| -> :text

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
count Integer! = 0

@inc = {
  count <- count + 1
  -> value: count
}
```

Use `<-` for ref mutation. Use `=` for binding. Pass a ref cell with `&name`
when a function parameter expects `Type!`.

```brevity
@bump = {
  inc = |target Integer!| { target <- target + 1 }
  inc(&count)
  -> value: count
}
```

## Dependencies

Declare dependencies in the file header:

```brevity
<
  "/services/store": (Store) {
    get: (:key Text) -> (:value Text)
    put: (:key Text, :value Text) -> .
  }
>
=

@fetch = |:key Text| {
  :value Text = Store.get(:key)
  -> :value
}

@save = |:key Text, :value Text| {
  Store.put(:key, :value) .
}
```

Silent methods return `.`. Replying methods bind their named reply fields.

## Remote Instances

Remote dependency constructors are written with `Name!(...)`:

```brevity
<
  "WebView": (WebView) <:path Text> -> {
    open: () -> .
    close: () -> .
  }
>
=

view = WebView!(path: "/main")

@open = { view.open() . }
```

Use named arguments for remote instance creation unless the tests for a case
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

Shape field access is local value access. Actor dependency calls are message
sends.

## Core Data Work

Use built-in methods through type calls, receiver calls, or bang ref calls:

```brevity
upper Text = Text.upper("hello")

name Text! = " ada "
clean Text = name.trim
name.trim!

items List of Integers! = [1, 2, 3]
items.append!(4)

payload Blob = Blob.from_hex("68656c6c6f")
```

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
