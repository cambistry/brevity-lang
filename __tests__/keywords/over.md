# `over`

LLM orientation: `over` maps a list to another list. It preserves list shape.

## Canonical Forms

Inline trailing block:

```brevity
result List of Integers = over(nums) (item Integer) { item + 1 } as Integer
```

Function reference:

```brevity
double
  =
  n Integer
  =
  -> (n * 2) as Integer

result List of Integers = over(nums, &double)
```

Lineal trailing block:

```brevity
result List of Integers = over nums
  =
  item Integer
  =
  -> item * 2 as Integer
```

## Tested Behavior

- Parenthesized and no-paren call forms are supported.
- Inline trailing blocks and lineal trailing blocks are supported.
- `&fn` works for file-level helpers and local lambdas.
- Empty lists map to `[]`.
- Untyped bodies can emit per-element `bv-a` component types.
- A bare function name without `&` is a compile error.

## LLM Rules

- Use `&name` when passing a named function to `over`.
- Use `over` for element-wise transformation, not accumulation.
- Use `reduce` when the result is a single accumulated value.
- Do not claim standalone side-effect-only `over` is implemented; the test is
  still todo.
