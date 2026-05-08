# Brevity Language Overview

Brevity is an actor-first language for the Contextual Actor Model, or CAM. CAM
is the idea that programs are trees of contextual actors that communicate by
messages. Brevity gives that model a compact source form.

For the conceptual introduction, start with [docs/CAM.md](./docs/CAM.md). For
test-backed, LLM-oriented feature notes, start with
[__tests__/README.md](__tests__/README.md).
For source generation patterns, use
[docs/LLM_WRITING_BREVITY.md](./docs/LLM_WRITING_BREVITY.md) and
[docs/SYNTAX_CRIB.md](./docs/SYNTAX_CRIB.md).

## Current Center

- The file is the actor.
- `@name` defines a public message handler.
- `#name` defines a private function.
- `*(...)` defines construction-time params and dependency context.
- `Type!` marks a mutable or actor-like cell.
- `Name!(...)` creates an actor-like/messageable instance.
- `::Name = (...)` declares a shape type.
- Argument lists can be positional, named, or mixed on both input and return.

## Public Surface

Handlers are the public message surface of the actor.

```brevity
@ping = -> status: "ok"

@add = (:a Integer, :b Integer) -> sum: (a + b)
```

Multiple handlers may share a name. Dispatch is based on message shape and type
attestation.

## Arguments and Replies

Brevity treats an argument list as a real data shape. A handler or function can
accept positional args, named args, or a mixed list:

```brevity
@mix = (left Integer, :right Integer) -> total: (left + right)
```

The same idea applies to replies. Brevity does not only return one scalar or
one object. It can return a full positional, named, or mixed argument list:

```brevity
pair = (a Integer, b Integer) ->(a, b)

summary
  =
  n Integer
  =
  doubled Integer = n * 2
  ->(
    n,
    :doubled,
    label: "done"
  )
```

Call sites can destructure the returned list directly:

```brevity
@pipe
  =
  v Integer, :doubled Integer, label: lbl Text = summary(5)
  -> :v, :doubled, :lbl
```

This is one of Brevity's data-piping tools. A call can pass through a structured
bundle of positionals and names without immediately collapsing it into a class,
record, or ad hoc object. The wire-level `op` and `re` fields use the same
message-shaped idea.

## Surface Forms and Effects

Brevity has dense delimited forms and spacious lineal forms. They are surface
choices for the same underlying callable model.

```brevity
@double = (n Integer) -> result: n * 2

@doubleLineal
  =
  n Integer
  =
  -> result: n * 2
```

Replying functions use `->`. Effect-only functions use `.` or `-> .`:

```brevity
*(
  "/services/log": (Log) {
    write: (:message Text) -> .
  }
)
=

@notify = (:message Text) {
  Log.write(:message) .
}
```

Use `spawn` when a replying handler should start a silent operation without
waiting for a reply.

## Constructor and Dependency Context

Constructors use `*(...)`:

```brevity
Box = *(value Integer) {
  @get = -> value
}
```

The file actor can also declare dependencies in a top-level header:

```brevity
*(
  "Remote": (Remote) {
    get: (:url Text) -> (:response Text)
  }
)
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
count *Integer = 0

@inc = {
  count <- count + 1
  -> value: count
}
```

Pass the cell itself with `*name` (call-site write-capability grant):

```brevity
@bump = {
  inc = (target *Integer) { target <- target + 1 }
  inc(*count)
  -> value: count
}
```

## Remote Instances

Remote constructors use `Name!(...)` and emit a `#new` CAM message:

```brevity
*(
  "WebView": (WebView) *(:path Text) -> {
    open: () -> .
  }
)
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

## Data and Collections

Core scalar and collection behavior is documented beside the tests:

- [Core Types](__tests__/core_types/index.md)
- [Core Type Methods](__tests__/core_types/methods.md)
- [Text Methods](__tests__/core_types/text_methods.md)
- [List Methods](__tests__/core_types/list_methods.md)
- [Blob Methods](__tests__/core_types/blob_methods.md)

Use type calls for pure operations, receiver calls for value-returning reads,
and bang calls for same-family mutations on `Type!` refs.

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
3. `*(...)` is the actor's construction and dependency boundary.
4. `Type!` is explicit state or actor-like identity.
5. CAM messages are the common model across local, remote, test, and lifecycle
   behavior.
