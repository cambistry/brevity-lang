# Literal Type Inference

LLM orientation: this directory covers inferred types for literal values.

## Inferred Literal Types

- `"hello"` -> `Text`
- `42` -> `Integer`
- `3.14` -> `Decimal`
- `1.23E+2` -> `Float`
- `true` / `false` -> `Boolean`
- `null` -> `null`

Inference is tested for:

- local assignment
- reply fields
- function arguments
- structure fields

Explicit annotations can coexist with inferred literals:

```brevity
x Integer = 5
msg Text = "hi"
```

## LLM Rules

- Use explicit annotations when the example's type should be obvious to a reader.
- Rely on inference for small literals only when the surrounding code is simple.
- Use scientific notation when a `Float` literal is specifically desired.
