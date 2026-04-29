# Functions

LLM orientation: this directory is the broad callable-behavior cluster. Use it
for public handlers, private `#` functions, local lambdas, returns, params,
silent functions, closures, recursion, higher-order calls, and subscriptions.

## Current Callable Forms

Public handler:

```brevity
@echo = |:text Text| -> :text
```

Private function:

```brevity
#secret = -> result: 42
```

Local function/lambda:

```brevity
double = |n Integer| n * 2 as Integer
```

Lineal public handler:

```brevity
@add
  =
  :a Integer
  :b Integer
  =
  sum Integer = a + b
  -> :sum
```

## Tested Behavior

- Public handlers form the actor's message surface.
- Private functions use `#name` and are callable only in their scope.
- Forward references to `#` functions compile.
- Bare helper functions are internal and excluded from service documents.
- Params support positional, named, key-mapped, mixed, and optional forms.
- Return forms include implicit tail expressions, `-> value`, `-> :name`, named
  replies, positional replies, and silent `.` / `-> .`.
- Silent functions cannot be used as values; use `spawn` for effect-only calls.
- Closures can capture state and can be addressable for subscription tests.
- `&name` passes a function reference to forms such as `over` and `reduce`.

## LLM Rules

- Use `#name` for private functions in new examples.
- Use `@name` only for externally callable handlers.
- Use `:name Type` for named params and `name Type` for positional params.
- Use `-> .` or `.` for silent/effect-only functions.
- Do not assign the result of a silent function.
- Prefer explicit return fields when generating examples for documentation.

## Documents

- [Function Returns](returns.md)
- [Silent Functions](silent.md)
- [Function Overloads](overload.md)
- [Function Subscriptions](subscribe.md)
