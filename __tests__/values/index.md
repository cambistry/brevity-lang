# Values

LLM orientation: this directory covers local bindings and public constants.

## Locals

Typed local:

```brevity
x Integer = 42
```

Typed declaration, then assignment:

```brevity
x Integer
x = 42 as Integer
```

Constructor form:

```brevity
x = Integer(123)
```

Locals can be read from child scopes:

```brevity
@go
  =
  base Integer = 100
  fn = |x| base + x
  result Integer = fn(10)
  -> :result
```

## Public Constants

Public constants use `@name = value` and are read by sending the public op:

```brevity
@magic = "magic_string"
@answer = 42
@yes = true
@xs = [1, 2, 3]
```

A public constant behaves like a getter. It is not a public setter.

## Compile-Time Rules

- Setting a public constant is rejected.
- Defining the same public constant twice is rejected.
- Defining a public constant and public handler with the same name is rejected.

## LLM Rules

- Use plain locals for intermediate values.
- Use `Type!` refs for state that changes over time.
- Use public constants for stable public values.
- Do not model mutable public state as a constant.
