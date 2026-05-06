# `reduce`

LLM orientation: `reduce` folds a list into one accumulated result.

## Canonical Forms

With an initial value and function reference:

```brevity
add
  =
  acc Integer
  item Integer
  =
  -> acc + item as Integer

result Integer = reduce(0, nums, &add)
```

With an inline trailing block:

```brevity
result Integer = reduce(1, nums) (acc Integer, item Integer) {
  acc * item
} as Integer
```

Without an initial value:

```brevity
result Integer | null = reduce(nums, &add)
```

## Tested Behavior

- Parenthesized and no-paren call forms are supported.
- Initial-value and no-initial forms are supported.
- No-initial reduction of an empty list returns `null`.
- No-initial reduction uses `Integer | null` in tested examples.
- Inline and lineal trailing block forms are supported.
- A bare function name without `&` is a compile error.

## LLM Rules

- Use `&name` when passing a named reducer.
- Use an explicit initial value when you want a non-null result type.
- Use `Integer | null` or similar union types for no-initial examples.
- Use `over` instead when the result should remain a list.
