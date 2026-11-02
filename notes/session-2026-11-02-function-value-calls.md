# Session 2026-11-02: a call to a function value is one value

`g = f as Function; return r: g(1)` was reported as a whole Object on JS, `1` on Rust and `null` on
Erlang. Re-run with `f = (x Integer) -> x + 1`, Rust gave the right `2` through `as`.

## Cause

Not `as`. The same call with no `as` also differed:

| `return r: f(1)` | Before |
|---|---|
| JS | whole Object: `{ positional: [2], named: {}, … }` |
| Erlang | `null`: the raw `{Pos, Named}` tuple, which JSON can't carry |
| Rust | didn't compile: `cannot find value f` |

A function's call gives back its whole reply. Positional returns took the value out of it, and named
ones never did, on JS or Erlang. `as` only changed which route Rust took: `g = f as Function` kept a
binding for `f`, and a direct `f(1)` lost it.

## Decision

**A call where one value belongs takes that value,** as a positional return and `x = f()` already did.
A function that returns two values, or only names, ends the call with an `ex`, on every target.

## Fixes

**All targets**

- `top as Function` on one of the file's functions now means `&top` (`lowerFunctionAs` in
  `validate.js`). It failed differently on each target.

**JS**

- `genValue` unwraps a call in a named return, a list element and an interpolation.
- `g = f` is accepted when `f` holds a function. Erlang and Rust already took it.
- Removed the separate branch for calling a local function. `lambdaVarNames` is per file, so a `g`
  holding a lambda in one function made a `g = &top` in another get called as a label, and fail.

**Erlang**

- Named returns, list elements and interpolations use `genExprScalar`.
- Calling a local holding a label no longer depends on the file having a lambda. Before, `g = &top`
  in a file with none failed.
- A list of unknown elements in a named return gets no `bv-a`, as on JS and Rust.

**Rust**

- A local function stays bound if any call to it isn't the whole value of a bind, or if `&f` names it.
- A reply no longer generates the body of a function with params in place, where its params weren't
  bound.
- A named return uses the hoisted call. It was generated a second time, so **the function ran twice.**
- A call through a function value can be an arithmetic or comparison operand.
- An untyped `y = x + 1` or `r = 5` takes the type of its arithmetic or literal, instead of a `Value`
  that didn't compile.
- `one_or_null` gives `null` only when the reply is empty. A names-only reply is now an error, as
  elsewhere.

## Open

- **`return r: g(1) + 10`** with no annotation: JS refuses it at compile time (`requires a type
  annotation`), and Erlang returns `12`. That's the JS-only annotation rule, not how the call works.
  `v Integer = g(1) + 10` agrees everywhere.
- **`lambdaVarNames` is still per file** on all three targets. The JS failure it caused is gone, but
  the set is still wider than the function it describes.

## Tests

"calling a function value" in `__tests__/functions/higher_order.test.js`.

## Verification

Scoped runs, not the full suites:

- **JS:** `functions`, `types`, `core_types`, `keywords`.
- **Browser:** `__tests__/html`.
- **Erlang:** `functions`, `types`, `core_types`, `keywords`.
- **Rust:** `functions`, `types`, `core_types`, `keywords`, on the final code.

JS and Erlang ran before the last two Rust-only changes, which don't touch their code.
