# Compact Language Profile

This is a compact, app-facing profile of Brevity's currently safe subset.

## Mental Model

- A file is the primary actor-like unit.
- Public behavior is exposed through `@handlers`.
- Dependencies are declared at the top in a `< ... >` header.
- Calls to declared aliases become message sends.
- Replies come back into the current handler and can be returned to the caller.
- `Type!` marks mutable state cells.
- `Name!(...)` creates messageable actor-like instances.

## Public Handlers

Use `@name` for public operations.

```brevity
@status = -> ok: "ready"

@echo = (:text Text) ->(:text)
```

A longer handler can use lineal form:

```brevity
@add
  =
  :a Integer
  :b Integer
  =
  sum Integer = a + b
  -> :sum
```

## Dependency Header

Declare dependencies in a top-level `< ... >` block.

```brevity
<
  "/services/db": (DB) {
    lookup: (:key Text) -> (:value Text)
  }
>
=
```

Then call through the alias:

```brevity
@query = (:key Text) {
  :value Text = DB.lookup(:key)
  -> :value
}
```

## Remote Instances

Constructor-like remote refs are written with `Alias!(...)`.

```brevity
<
  "WebView": (WebView) <:path Text> -> {
    open: () -> .
    close: () -> .
  }
>
=

view = WebView!(path: "/demo")

@open = { view.open() . }
```

Use named arguments for clarity.

## State Refs

A `Type!` ref holds mutable state.

```brevity
content Text! = "initial"

@bump = (:v Text) { content <- v . }
```

Prefer public mutation handlers instead of hidden writes.

## DOM / Factory Shape

A factory-style actor can return DOM-like structures from a public handler.

```brevity
<
  "DOM": (DOM) {
    div: () -> .
  }
>
=

content Text! = "initial"

@bump = (:v Text) { content <- v . }
@create = -> <div>{ content }</div>
```

## Conservative Style

- Use named params: `(:name Text) -> `
- Use named replies: `-> :value` or `-> ok: "ready"`
- Use explicit locals before returning transformed data
- Use one step per line in multi-step handlers
