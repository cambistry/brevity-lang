# Function Returns

LLM orientation: use this for return shapes in handlers, lambdas, and private
functions. Prefer explicit named returns in generated examples.

## Implicit Tail Return

The final expression in a block can be the return value:

```brevity
fn = |a| { a + 1 }
```

With intermediate work:

```brevity
fn = |a| {
  x = a * 2
  x + 1
}
```

## Explicit Return

Single positional:

```brevity
-> a as Integer
```

Multiple positional:

```brevity
-> a, b
```

Named return:

```brevity
-> :value
-> result: value
```

Paren forms are also tested:

```brevity
-> (a as Integer)
-> (:a, :b)
-> (result: (a + 1) as Integer)
```

## Early Return

Statements after `->` in the same block are not evaluated:

```brevity
fn = |a| {
  -> a as Integer
  a + 999
}
```

## Arity

Assigning a multi-positional return into a single plain binding is a runtime
error in the tested case. Destructure multi-value returns:

```brevity
x, y = fn(3, 4)
```

## LLM Rules

- Prefer `-> :name` or `-> field: expr`.
- Use destructuring for multi-value returns.
- Use `as Type` when the result type should be stable.
- Use `.` or `-> .` for silent functions; see [Silent Functions](silent.md).
