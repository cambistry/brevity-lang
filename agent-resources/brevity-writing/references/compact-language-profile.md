# Compact Language Profile

This is a compact, app-facing profile of Brevity's currently safe subset.

## Mental Model

- A file is the primary actor-like unit.
- Public behavior is exposed through `@handlers`.
- Dependencies are declared at the top in a `*` … `*` header.
- Calls to declared aliases become message sends.
- Replies come back into the current handler and can be returned to the caller.
- `*Type` marks a mutable state cell: `count *Integer = 0`.
- `*Name(...)` constructs an actor of a remote-declared class.
- A function's name says whether it writes: `inc!` writes, `log.` is silent,
  no mark is read-only. The compiler checks it.

## Public Handlers

Use `@name` for public operations.

```brevity
@status = -> ok: "ready"

@echo = (text: Text) ->(:text)
```

A longer handler can use lineal form:

```brevity
@add
  =
  a: Integer
  b: Integer
  =
  sum Integer = a + b
  return :sum
```

## Dependency Header

Declare dependencies in a top-level `*` … `*` header, one entry per line.

```brevity
*
  "/services/db": DB {
    lookup (key: Text) -> (value: Text)
  }
*
```

Then call through the alias:

```brevity
@query = (key: Text) {
  :value Text = DB.lookup(:key)
  return :value
}
```

## Remote Instances

Construct a remote-declared class with `*Alias(...)`.

```brevity
*
  "WebView": WebView (path: Text) -> *{
    open. () => .
    close. () => .
  }
*

view = *WebView(path: "/demo")

@open. = { view.open... }
```

Use named arguments for clarity.

## State Refs

A `*Type` cell holds mutable state. Write it with `<-`.

```brevity
content *Text = "initial"

@set_content! = (v: Text) { content <- v }   // writes, returns self
@bump. = (v: Text) { content <- v }          // writes, silent
```

Prefer public mutation handlers instead of hidden writes.

## Effects

- **No mark:** read-only. The tail expression is the reply.
- **`name!`:** writes. Falling off the end returns `self`; `return v` returns `v`. Never
  end it with a bare value: write `return v`.
- **`name.`:** silent, no reply. Call it with `...`.
- A function that calls a `!` or `.` function writes too, so it needs a mark.
- In a dependency header, the arrow states the effect: `->` reads, `=>` writes,
  `~>` claims to read. `=> self` returns self, `=> .` is silent.
- Mark logs, metrics and caches `untracked`, so they don't count as writes.

```brevity
count *Integer = 0

@total = -> count
@inc! = (by: Integer) { count <- count + by }
@take! = {
  v Integer = count
  count <- 0
  return v
}
```

Chain on `!` calls that return self: `c.inc!(by: 1).inc!(by: 2).total()`. Bind a value
first: `v Integer = c.take!()`.

## DOM / Factory Shape

A factory-style actor can return DOM-like structures from a public handler.

```brevity
*
  "DOM": DOM {
    div. () => .
  }
*

content *Text = "initial"

@bump. = (v: Text) { content <- v }
@create = -> <div>{ content }</div>
```

## Conservative Style

- Use named params: `(name: Text) -> `
- Name every function that writes with `!`, or `.` if it doesn't reply
- Use named replies: `-> :value` or `-> ok: "ready"`
- Use explicit locals before returning transformed data
- Use one step per line in multi-step handlers
