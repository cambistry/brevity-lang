# Type construction: named & mixed attributes (2026-10-26)

## Problem

Type construction (`Point(...)`) was supposed to accept positional, named, or
mixed attributes, with optional (`?`) fields supported. In practice only
positional construction and a narrow sliver of named construction worked:

- `Point(x: 1, y: 2)` (all named, 2 required fields) → **rejected**
  (`expects 2 arguments, got 1`)
- `Point(y: 2, x: 1)` (reordered) → rejected
- `Point(x: 1)` on a type whose only required field count was ≤ 1 →
  accidentally accepted

### Root cause

The parser collects all `name: expr` args into a single trailing
`NamedArgsBag` node (`parseCallArgs`, parser.js:755). `checkTypeConstructions`
(validate.js) counted `node.args.length`, so a bag of N named fields counted as
**one** arg. Named construction only slipped through when the resulting count of
`1` happened to satisfy `requiredCount` — i.e. when all-but-one field was
optional. That is the "only works when optional, and only a single one"
behavior.

The JS codegen (expressions.js:558) was already correct — it fills fields by
index from positional args, then by name from the bag. Only the validator was
wrong.

## Fix

Rewrote the `TypeConstruction` branch of `checkTypeConstructions`
(src/validate.js). Positional-only construction keeps its original count-range
message. When a `NamedArgsBag` is present it now validates by field identity:

- positional args fill fields left-to-right (can't exceed field count);
- each named key must be a declared field;
- a field can't be supplied both positionally and by name;
- every non-optional field must end up filled (positionally or by name).

New diagnostics: `has no field named 'z'`, `supplies field 'x' both
positionally and by name`, `is missing required field(s) ...`, `at most N
positional arguments, got M`.

## Tests

`__tests__/types/type_named_construction.test.js` — parser shape, accepted
forms (all-named, reordered, mixed, 3-field, named+optional), rejected forms
(unknown key, double-supply, missing required, positional overflow), and
runtime placement (values follow the field name, not the slot). Full js suite
green (2619 passed).

## Not touched

Rust / Erlang codegen named-bag handling for TypeConstruction wasn't audited
here (js-only test scope). Duplicate named keys (`Point(x:1, x:2)`) still
collapse silently in `parseCallArgs` for all call sites — pre-existing, out of
scope.
