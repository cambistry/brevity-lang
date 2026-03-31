# Brevity Language Overview

Brevity is an actor-first language for describing message-handling systems.
It is not trying to be a general-purpose replacement for JavaScript, Rust, or
Erlang. It is a language for defining actors and compiling them into those
targets.

## The model

The file is the actor.

At top level:

- `@name` defines a public handler
- plain names define private functions or values
- `<...>` defines constructor inputs
- `*Type` marks an actor reference rather than a plain value

That gives the language a small center of gravity:

- one unit of composition: the actor
- one public surface marker: `@`
- one constructor boundary: `<...>`
- one actor-reference marker: `*`

## Public surface

Handlers are the public API of the actor.

```brevity
@ping = -> status: "ok"

@add = |a: Integer, b: Integer| -> sum: (a + b) as Integer
```

Multiple handlers may share a name. Dispatch is based on the message shape and
its attached type information.

## Constructors

Constructors use `<...>`.

```brevity
Box = <value: Integer> {
  @get = -> value as Integer
}
```

Wrapped child constructors can accept actor references directly:

```brevity
Inner = <> {
  @double = |n: Integer| -> result: (n * 2) as Integer
}

Wrapper = <inner *> {
  @quadruple = |n: Integer| {
    result: Integer = inner.double(n: n)
    -> result: (result * 2) as Integer
  }
}
```

Supported wrapped forms include:

```brevity
<inner *>
<inner*>
<child: *>
<child: (inner) *>
<child: inner*>
```

The key idea is that constructor inputs are not only initialization data. They
also define part of the actor's boundary.

## Actor references with `*`

`*` means "this thing is an actor-like reference, not just a scalar value."

Local actor state:

```brevity
count *Integer = 0

@inc = {
  count <- count + 1
  -> value: count
}
```

Wrapped constructor params:

```brevity
Wrapper = <inner *> {
  @call = -> inner.double(n: 5)
}
```

The same idea shows up at both scales: a `*` binding is something you can
message.

## Two surface forms

Brevity has two freely mixable surface syntaxes.

Delimited form:

```brevity
@double = |n: Integer| -> result: (n * 2) as Integer
```

Lineal form:

```brevity
@double
  =
  n: Integer
  =
  -> result: (n * 2) as Integer
```

These compile to the same AST. The choice is about density and readability, not
semantics.

## Private functions and self-sends

Private function calls are routed through the actor's own dispatch path.
Conceptually, actors call themselves by message.

That gives Brevity a few important properties:

- public and private behavior share one dispatch model
- forward references are easier to support
- serialization and replay are more coherent

The implementation details differ by backend, but the language model stays the
same.

## Data and replies

Handlers and functions reply with structures.

```brevity
@pair = -> left: 1 as Integer, right: 2 as Integer
```

Destructuring is used heavily:

```brevity
@go = {
  left: a, right: b = pair()
  -> total: (a + b) as Integer
}
```

Lists and structures are the core aggregate forms. Scalars include `Integer`,
`Decimal`, `Float`, `Text`, `Boolean`, and `null`.

## Host API

The JavaScript host API is intentionally small:

```js
import { extract, compile } from 'brevity-lang';

const { ast, manifest } = extract(source);
const output = compile(ast, { target: 'js' });
```

`extract(source)` returns:

- `ast`
- `manifest.service`

`compile(ast, { target })` validates and emits code for:

- `js`
- `rust`
- `erlang`

Even if tooling eventually grows around the language, this split is the current
public compiler shape.

## Current emphasis

If you are trying to understand Brevity quickly, start here:

1. The file is the actor.
2. `@` is the public interface.
3. `<...>` is the constructor boundary.
4. `*` marks actor references.
5. Lineal and delimited syntax are equivalent surface forms.

Everything else is downstream of those choices.
