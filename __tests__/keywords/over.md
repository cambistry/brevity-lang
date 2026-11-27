# `over`

LLM orientation: `over` maps a list to another list. It preserves list shape.

## Canonical Forms

Inline trailing block:

```brevity
result List[Integer] = over(nums) (item Integer) { item + 1 as Integer }
```

Function reference:

```brevity
double
  =
  n Integer
  =
  return (n * 2) as Integer

result List[Integer] = over(nums, &double)
```

Lineal trailing block:

```brevity
result List[Integer] = over nums
  =
  item Integer
  =
  return item * 2 as Integer
```

## Tested Behavior

- Parenthesized and no-paren call forms are supported.
- Inline trailing blocks and lineal trailing blocks are supported.
- `&fn` works for file-level helpers and local lambdas.
- Empty lists map to `[]`.
- Untyped bodies can emit per-element `ty` component types.
- A bare function name without `&` is a compile error.
- Standalone `over` (a statement, result discarded) runs its body per element
  for side effects, e.g. `over(nums) (item Integer) { total <- total + item }`.

## LLM Rules

- Use `&name` when passing a named function to `over`.
- Use `over` for element-wise transformation, not accumulation.
- Use `reduce` when the result is a single accumulated value.
