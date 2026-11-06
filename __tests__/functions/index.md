# Functions

LLM orientation: this directory is the broad callable-behavior cluster. Use it
for public handlers, private `#` functions, local lambdas, returns, params,
silent functions, closures, recursion, higher-order calls, and subscriptions.

## Current Callable Forms

Public handler:

```brevity
@echo = (text: Text) -> :text
```

Private function:

```brevity
#secret = -> result: 42
```

Local function/lambda:

```brevity
double = (n Integer) ->  n * 2 as Integer
```

Writing and silent functions:

```brevity
n *Integer = 0
@inc! = (i Integer) { n <- n + i }   // writes; returns self
@reset. = { n <- 0 }                 // silent; no reply
```

Lineal public handler:

```brevity
@add
  =
  a: Integer
  b: Integer
  =
  sum Integer = a + b
  return :sum
```

## Tested Behavior

- Public handlers form the actor's message surface.
- Private functions use `#name` and are callable only in their scope.
- Forward references to `#` functions compile.
- Bare helper functions are internal and excluded from service documents.
- Params support positional, named, key-mapped, mixed, and optional forms.
- Return forms include implicit tail expressions, `-> value`, `-> :name`, named
  replies, positional replies, and silent `name.` functions (`=> .` in docs).
- A function that writes is named `!` or `.`; no mark means read-only. A `!` function
  has no tail return: falling off the end returns `self`, `return v` returns `v`
  (`bang.test.js`).
- Docs and function types state the effect in the arrow: `->` reads, `=>` writes,
  `~>` claims to read. `=> self` and `=> .` are the self-returning and silent forms.
- `untracked` cells, functions and nested actors don't count as writes.
- Silent functions cannot be used as values; use `spawn` for effect-only calls.
- Closures can capture state and can be addressable for subscription tests.
- `&name` passes a function reference to forms such as `over` and `reduce`. A
  writing function keeps its suffix (`&bump!`, `&fire.`), and a `->` slot rejects it.

## LLM Rules

- Use `#name` for private functions in new examples.
- Use `@name` only for externally callable handlers.
- Use `name: Type` for named params and `name Type` for positional params.
- Name silent/effect-only functions with a glued `.` (`fire.`) and call them with `...`.
- Do not assign the result of a silent function.
- Name a writing function `!`, end it with the write or a `return`, and bind a `!`
  call's value before chaining on it. Full rules: [Syntax Crib](../../docs/SYNTAX_CRIB.md).
- Prefer explicit return fields when generating examples for documentation.

## Documents

- [Function Returns](returns.md)
- [Silent Functions](silent.md)
- [Function Overloads](overload.md)
- [Function Subscriptions](subscribe.md)
