# Brevity

Brevity is an actor-first language that compiles to JavaScript, Rust, and Erlang.

The file is the actor. `@` marks the public surface. Constructors, handlers,
private functions, and lambdas all share the same basic shape.

## Why it is interesting

- The file is the unit of behavior.
- Public API is explicit: `@name` means "this actor handles that message."
- Two surface forms are available: spacious lineal syntax and dense delimited
  syntax.
- Actor references use `*`, and wrapped constructors use `<...>`.
- The host API is split into `extract()` and `compile()` so tooling can parse
  once and compile later.

## Tiny example

```brevity
count *Integer = 0

@inc = {
  count <- count + 1
  -> value: count
}

@get = -> value: count
```

## Wrapped constructor example

```brevity
Inner = <> {
  @double = |n: Integer| -> result: n * 2
}

Wrapper = <inner *> {
  @quadruple = |n: Integer| {
    result: Integer = inner.double(n: n)
    -> result: result * 2
  }
}
```

## Host API

```js
import { extract, compile } from 'brevity-lang';

const source = `
  count *Integer = 0
  @inc = {
    count <- count + 1
    -> value: count as Integer
  }
`;

const { ast, interface: iface } = extract(source);
const js = compile(ast, { target: 'js' });
```

`extract()` parses source and returns the AST plus an interface describing the
public operations. `compile()` validates that AST and emits code for `js`,
`rust`, or `erlang`.

## Development

```bash
npm install
npm test
```

## More

- Language guide: [LANGUAGE_OVERVIEW.md](./LANGUAGE_OVERVIEW.md)
- Runtime and wire details: [USAGE.md](./USAGE.md)
