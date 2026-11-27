---
created: 2026-11-27
---
# Feature: a prefix `!` negates, as `not` does

The user leans toward `!` for logical negation, with `not` kept as well. Today only `not b` negates;
`!b` is a parse error (`Unexpected token in expression: BANG`).

```brevity
@f = (b Boolean) {
  if (!b) { return 1 }      // a parse error today; `if (not b)` compiles
  return 2
}
```

Expected, on js, erlang and rust: a prefix `!` before an expression is its negation, the same as
`not`, in every position `not` takes, including a null guard's early exit
(`a-call-through-a-name-that-may-be-null-is-guarded`). A `!` that ends a name (`bump!`, a writer)
keeps its meaning: `!` negates only where an operand is expected.

Open: whether `not` stays as a spelling, or `!` replaces it.
