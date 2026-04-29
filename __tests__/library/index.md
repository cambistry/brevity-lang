# Library

LLM orientation: this directory covers library-level functions, currently the
`Math` namespace.

## Math Methods

Tested functions include:

- `ceil`, `floor`, `round`, `trunc`
- `abs`, `sign`, `min`, `max`
- `sqrt`, `exp`, `log`
- `sin`, `cos`, `tan`
- `asin`, `acos`, `atan`, `atan2`
- `pow`
- `sinh`, `cosh`, `tanh`
- `asinh`, `acosh`, `atanh`
- `divide`

Constants:

- `Math.pi`
- `Math.e`

## Type Notes

- Many transcendental functions return `Float`.
- `Integer` and `Decimal` inputs are accepted for several functions and often
  coerce to `Float`.
- `pow(Integer, Integer)` can return `Integer`.
- `pow(Decimal, Integer)` can return `Decimal`.
- `round` uses half away from zero in tested cases.
- `Math.divide(a, b, places)` controls decimal places.

## Receiver Syntax

Some math functions work as dot methods on numeric refs:

```brevity
x Float! = 4.0
result Float = x.sqrt()
```

## LLM Rules

- Use `Math.name(...)` for clarity.
- Use `Float` for transcendental results.
- Use `Math.pi` and `Math.e` for constants.
