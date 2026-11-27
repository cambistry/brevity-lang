# The pipe, and clause lists' open questions — 2026-11-26

Decided in discussion. Extends `clause-lists-2026-11-25.md` and settles its open questions.

## `|>`

`v |> f(a)` is `f(v, a)`, as in Elixir.

- **Precedence:** lowest of the binary operators, left-associative. `v |> f |> g(a)` is
  `g(f(v), a)`, and `a + b |> f` is `f(a + b)`.
- **A bare callee** is called with the value alone: `v |> f` is `f(v)`.
- **Any call shape takes it:** a member or remote call works the same, `v |> svc.lookup(a)` is
  `svc.lookup(v, a)`; so does a writing call, `v |> add!(a)` is `add!(v, a)`.
- **A line may start with `|>`**, continuing the previous line:

  ```brevity
  names = rows
    |> List.filter(active)
    |> List.map(name)
  ```

## Writes in a clause list

The writes of any clause belong to the clause list as a whole. A clause list bound to a name
takes `!` if any clause writes: `keys! = [ … ]`. An anonymous clause list has no name to carry
`!`, so by the rule for anonymous functions (`mutation-suffix-2026-10-31.md`, settled
2026-11-03) its writes are attributed to the function that defines it, which must be `!`.

## `Function()` and `[]`

Both stay. They are the same value, an empty clause list, and differ only in where the type comes
from:

- `Function()` carries its type: a list of functions. So `Shape(…)` compiles and `Shape << …`
  appends, with no annotation.
- `[]` takes its type from its slot or annotation. `Shape (Integer) -> Text = []` is the same
  callable value. An untyped `[]` is a List with no known element type, so calling it is a
  compile error, by the element-type check in the 2026-11-25 note.

## Guards: no `when`

A head never carries a condition on its binding; `n (n > 10) -> …` is not a form. A guard runs
inside the clause: the body returns `unhandled` before any effect, and dispatch moves on to the
next clause, as for any overload. When the last clause declines, the caller gets `unhandled`.

```brevity
n -> {
  if (n <= 10) { return unhandled }
  big(n)
}
```

The mechanism is the ticket `implement-return-unhandled-bv-equivalent-of-a-guard`, which also
decides the keyword's spelling.

## Built separately

- **Zero params need `()`** (the 2026-11-25 note's arrow-params section) stands as design, and is
  built separately from the pipe and clause lists.
