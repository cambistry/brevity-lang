# Brevity Language Overview

Brevity is an actor-first language for the Contextual Actor Model, or CAM. CAM
is the idea that programs are trees of contextual actors that communicate by
messages. Brevity gives that model a compact source form.

For the conceptual introduction, start with [docs/CAM.md](./docs/CAM.md). For
test-backed, LLM-oriented feature notes, start with
[__tests__/README.md](__tests__/README.md).

## Current Center

- The file is the actor.
- `@name` defines a public message handler.
- `#name` defines a private function.
- `<...>` defines construction-time params and dependency context.
- `Type!` marks a mutable or actor-like cell.
- `Name!(...)` creates an actor-like/messageable instance.
- `::Name = (...)` declares a shape type.

## Public Surface

Handlers are the public message surface of the actor.

```brevity
@ping = -> status: "ok"

@add = |:a Integer, :b Integer| -> sum: (a + b)
```

Multiple handlers may share a name. Dispatch is based on message shape and type
attestation.

## Constructor and Dependency Context

Constructors use `<...>`:

```brevity
Box = <value Integer> {
  @get = -> value
}
```

The file actor can also declare dependencies in a top-level header:

```brevity
<
  "Remote": (Remote) {
    get: (:url Text) -> (:response Text)
  }
>
=

@fetch
  =
  :url Text
  =
  :response Text = Remote.get(:url)
  -> :response
```

The call to `Remote.get(:url)` is source-level syntax for a typed CAM message
to the declared dependency.

## Ref Cells

Mutable actor state is explicit:

```brevity
count Integer! = 0

@inc = {
  count <- count + 1
  -> value: count
}
```

Pass the cell itself with `&name`:

```brevity
inc = |target Integer!| { target <- target + 1 }
inc(&count)
```

## Remote Instances

Remote constructors use `Name!(...)` and emit a `#new` CAM message:

```brevity
<
  "WebView": (WebView) <:path Text> -> {
    open: () -> .
  }
>
=

view = WebView!(path: "/main")

@open = { view.open() . }
```

The returned instance address remains messageable.

## Shapes

Shape types are value types declared with `::`:

```brevity
::Point = (x Integer, y Integer)

@x = -> result: Point(1, 2).x as Integer
```

Shape field access is local value access, not a CAM round trip.

## Host API

The JavaScript host API is intentionally small:

```js
import { extract, compile } from 'brevity-lang';

const { ast, interface: iface } = extract(source);
const output = compile(ast, { target: 'js' });
```

`extract(source)` returns `ast`, `interface.params`, and `interface.service`.
`compile(ast, options)` validates and emits target code.

## Current Emphasis

If you are trying to understand Brevity quickly, start here:

1. The file is the actor.
2. `@` is the public message surface.
3. `<...>` is the actor's construction and dependency boundary.
4. `Type!` is explicit state or actor-like identity.
5. CAM messages are the common model across local, remote, test, and lifecycle
   behavior.
