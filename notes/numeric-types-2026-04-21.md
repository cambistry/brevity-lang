# Numeric types: Integer, Decimal, Float

IMPLEMENTED 2026-04-21 (`b3dbc59`, exact Decimal across JS/Erlang/Rust/Browser); `Math.divide` 2026-04-22 (`371e16e`).

## Types

- `Integer`: arbitrary-precision BigInt in every target. No small-int/big-int split.
- `Decimal`: scaled BigInt, `coefficient × 10^(-scale)`. Exact, arbitrary precision.
- `Float`: IEEE 754 f64, for hardware math (trig, transcendentals).

## Literal inference

- `42` → Integer
- `3.14` → Decimal (has a decimal point)
- `3.14e2` → Float (E-notation signals IEEE 754)

## Promotion and Math

Integer + Decimal → Decimal. Math functions (`sin`, `cos`, …) take and return Float.

## Integer division

`/` truncates toward zero; `%` takes the dividend's sign. JS BigInt, Erlang, and Rust num-bigint all agree.

## Decimal division

Exact when the result terminates, an error when it doesn't.

- `1.0 / 4.0` → `0.25`
- `7.5 / 2.5` → `3.0`
- `1.0 / 3.0` → error
- `Math.divide(1.0, 3.0, 10)` → `0.3333333333` (explicit truncation to N places)

A division terminates iff the divisor's prime factors, after cancelling with the dividend, are only 2s and 5s.

Compile-time error when the operands are literals or constants; runtime error otherwise. Same class as divide-by-zero: a mathematical constraint, not a precision choice.

Why: "optimize for accuracy". Silent precision loss violates it; a non-terminating result is ambiguous, so the programmer picks precision with `Math.divide`.

## `**`

- Integer: exponent must be a non-negative Integer. Right-associative, binds tighter than `*` `/` `%`.
- Decimal: exponent must be Integer. Positive is always exact; `a ** -n` = `1 / (a ** n)`, so the termination check applies (`3.0 ** -1` is a compile-time error).
- Float: no `**`; use the Math lib.

## Target mapping

| | Integer | Decimal |
|---|---|---|
| JS | `42n` | class `{ c: BigInt, s: Number }` |
| Erlang | `42` | `{decimal, Coefficient, Scale}` |
| Rust | `BigInt::from(42)` (num-bigint) | `struct BvDecimal { c: BigInt, s: u32 }` |
