# Brevity Language Overview

Brevity is an actor-first language for the Contextual Actor Model, or CAM. CAM
is the idea that programs are trees of contextual actors that communicate by
messages. Brevity gives that model a compact source form.

For the conceptual introduction, start with [docs/CAM.md](./docs/CAM.md). For
the runtime value/actor distinction, see
[docs/VALUES_AND_ACTORS.md](./docs/VALUES_AND_ACTORS.md). For test-backed,
LLM-oriented feature notes, start with [__tests__/README.md](__tests__/README.md).
For source generation patterns, use
[docs/LLM_WRITING_BREVITY.md](./docs/LLM_WRITING_BREVITY.md) and
[docs/SYNTAX_CRIB.md](./docs/SYNTAX_CRIB.md).

## Current Center

- The file is the actor.
- `@name` defines a public message handler.
- `#name` defines a private function.
- `*(...)` at file top declares class params and dependency context.
- `Name = *(...) { ... }` declares a class (constructs actors).
- `::Name = (...)` declares a type (constructs values).
- `*Type` marks a mutable cell or actor-shaped binding.
- `*Name(...)` constructs an actor of the named class.
- Argument lists can be positional, named, or mixed on both input and return.

## Values and Actors

Brevity has two runtime categories. A **value** is what a type constructs:
pass-by-value, immutable, no address. A scalar (`5`, `"hi"`) is a value. A
shaped datum (`Point(1, 2)`, `[1, 2, 3]`) is a value. An **actor** is what a
class constructs: addressable, mailboxed, possibly stateful. Mutation lives on
the actor side, in cells.

The prefix `*` sigil promotes a value to an actor. `Point(1, 2)` is a value;
`*Point(1, 2)` is an actor. `Integer` is a value type; `*Integer` is an actor
cell. The same sigil marks a class declaration (`*(params) { ... }`) as
actor-producing rather than value-producing.

For the full vocabulary and runtime axis, see
[docs/VALUES_AND_ACTORS.md](./docs/VALUES_AND_ACTORS.md).

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
one shaped value. It can return a full positional, named, or mixed argument
list:

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

This is one of Brevity's data-piping tools. A call can pass through a
structured bundle of positionals and names without immediately collapsing it
into a class, record, or ad hoc value. The wire-level `op` and `re` fields use
the same message-shaped idea.

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

## Classes and Dependency Context

A **class** constructs actors. Its header uses `*(...)`:

```brevity
Box = *(value Integer) {
  @get = -> value
}
```

The leading `*` marks the form as actor-producing. The `(value Integer)` is
the class header — the params accepted at construction. The `{ ... }` is the
constructor block — where state cells, handlers, and projections are declared.

The file actor itself can declare dependencies in a top-level header:

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

Mutable actor state is explicit. A `*Type` binding declares a cell:

```brevity
count *Integer = 0

@inc = {
  count <- count + 1
  -> value: count
}
```

The `<-` operator writes a new value into the cell. The cell's identity is
preserved; only its content changes.

Pass the cell itself with `*name` at the call site (the `*` grants write
capability on the receiving side):

```brevity
@bump = {
  inc = (target *Integer) { target <- target + 1 }
  inc(*count)
  -> value: count
}
```

## Remote Actors

A remote actor binding uses `*Name(...)`. Construction calls the remote class
— a `#new` CAM message is sent to the dependency address; the reply carries
the actor's address:

```brevity
*(
  "WebView": (WebView) *(:path Text) -> {
    open: () -> .
  }
)
=

view = *WebView(path: "/main")

@open = { view.open() . }
```

The returned actor address remains messageable.

## Shapes

Shape types declare value shapes with `::`:

```brevity
::Point = (x Integer, y Integer)

@x = -> result: Point(1, 2).x as Integer
```

Shape field access is local value access, not a CAM round trip. A `Point(1, 2)`
is a value. An `*Point(1, 2)` is an actor with the same shape.

## Data and Collections

Core scalar and collection behavior is documented beside the tests:

- [Core Types](__tests__/core_types/index.md)
- [Core Type Methods](__tests__/core_types/methods.md)
- [Text Methods](__tests__/core_types/text_methods.md)
- [List Methods](__tests__/core_types/list_methods.md)
- [Blob Methods](__tests__/core_types/blob_methods.md)

Use type calls for pure operations, receiver calls for value-returning reads,
and bang calls for same-family mutations on `*Type` cells.

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
4. `*Type` is an explicit cell, actor-shaped state, or actor-shaped binding.
5. CAM messages are the common model across local, remote, test, and lifecycle
   behavior.
