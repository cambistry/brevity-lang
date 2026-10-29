# Arithmetic on untyped params — 2026-10-29

IMPLEMENTED. Test: `__tests__/functions/untyped_param_arithmetic.test.js`
(Integer, Decimal, `**`, comparison; green on js, rust, erlang).

Tests (scoped): core_types decimal/integer/float/structure, functions
private/higher_order/arguments/overload/params + the new file — 404 passed,
4 skipped (already skipped) on each target.

## Bug

```
double = (n) { n * 2 }
@test = { result Integer = double(21); return :result }
```

A file-level function with an untyped param is generic: `n` is `Anything`.
Every target picked the operator's arithmetic from the *other* operand (the
literal `2` → Integer), which is wrong whenever the caller passes something
else.

- **rust** — didn't compile: `&n * &BigInt`, `n` is a `Value`
  (`cannot multiply &Value by &BigInt`).
- **js / erlang** — the reported "works" held only for Integer args. A Decimal
  arg threw at runtime (`_bv_int_op` / native `N * 2` on a `bv_decimal` tuple).
- **js, separate** — `BvObject.pack` took a trailing `BvDecimal` for the
  named-args dict, so a lone Decimal positional arg arrived as `undefined`.

## Fix

Of the report's two options (typed copy per call site vs. runtime dispatch),
took **runtime dispatch**: it matches what a generic function means and what
the existing generic `/` (`_bv_div` / `bv_div`) already does. Per-call-site
specialization stays available as a later optimization.

When either operand's inferred type is `Anything`, the operator routes through
a runtime helper that picks the arithmetic from the value (Float > Decimal >
Integer):

- rust `bv_dyn_arith(&Value, op, &Value) -> Value` (`program.js`); a number
  with no `.`/exponent is an Integer, else Decimal. Comparisons reuse
  `bv_eq` / `bv_cmp`. Codegen in `expressions.js` BinaryExpr, after the Float
  branch.
- js `_bv_num_op` (`preambles.js`), used when the int path would have fired.
- erlang `bv_num_op/3` (`preambles.js`), main BinaryExpr path only.
- js `BvObject.pack`: `BvDecimal` is positional, never the named bag.

## Not covered

- erlang `genInnerExpr` / `genInner` BinaryExpr copies (lambda/closure inner
  bodies) still emit native ops for `Anything` operands.
- `Anything + Anything` where both are Text: rust handles it; js/erlang go
  through the numeric helper as before.
