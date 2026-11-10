# Function Returns

LLM orientation: use this for return shapes in handlers, lambdas, and private
functions. Prefer explicit named returns in generated examples.

## Implicit Tail Return

The final expression in a block can be the return value:

```brevity
fn = (a) { a + 1 }
```

With intermediate work:

```brevity
@go = {
  fn = (a) {
    x = a * 2
    x + 1
  }
  return result: fn(4)
}
```

## Explicit Return

Single positional:

```brevity
fn = (a) { return a as Integer }
```

Multiple positional:

```brevity
fn = (a, b) { return a, b }
```

Named return:

```brevity
f = (a) { return :a }
g = (a) { return result: a }
```

Paren forms are also tested:

```brevity
f = (a) { return (a as Integer) }
g = (a, b) { return (:a, :b) }
h = (a) { return (result: (a + 1) as Integer) }
```

## Early Return

Statements after `return` in the same block are not evaluated:

```brevity
@go = {
  fn = (a) {
    return a as Integer
    a + 999
  }
  return result: fn(5)
}
```

## Arity

Assigning a multi-positional return into a single plain binding is a runtime
error in the tested case. Destructure multi-value returns:

```brevity
@go = {
  fn = (a, b) { return a, b }
  x, y = fn(3, 4)
  return :x, :y
}
```

## LLM Rules

- Prefer `return :name` or `return field: expr`.
- Use destructuring for multi-value returns.
- Use `as Type` when the result type should be stable.
- Name silent functions with a glued `.` (type `() => .`); see [Silent Functions](silent.md).
