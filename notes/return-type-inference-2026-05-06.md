# Function-level return-type annotation — dropped from braced bodies

Date: 2026-05-06

Status: **decided and implemented**. `} : Type` and `} as Type` after a closing function-body brace are now parse errors. Coercion goes inside the body via expression-level `as`.

## What changed

The parser accepts neither annotation after `}`:

```
fn = (a) { a * 2 } : Integer    // parse error
fn = (a) { a * 2 } as Integer   // parse error
```

For runtime coercion, write it on the value inside the body:

```
fn = (a) { (a * 2) as Integer }
```

Or — for a generic private function — drop the annotation entirely:

```
fn = (a) { a * 2 }
```

Implementation: `src/parser.js` `parseFunction` rejects both `as Type` and `: Type` after the closing `}` with a single error pointing at inline coercion as the fix.

## Why dropped

The annotation was decorative on private functions. The validator stored `returnType` but only consulted it in two narrow places (subclass-override consistency, the `while`-always-null check). There was no general body-vs-`returnType` comparison — `fn = (a Integer) { "hello" } : Integer` did not error.

A short-lived plan (earlier draft of this note) proposed **one-hop backward inference**: from the declared return + body tail, infer un-annotated param types. That plan was the wrong shape. The actual model:

- **Private/protected functions are generic-by-default.** Un-annotated params accept anything; the body dispatches polymorphically. No compile-time narrowing of params from a declared return.
- **Public handlers (`@`-prefixed)** carry a full interface contract — params and return all annotated — and the contract is the wire-protocol shape. Their type-checking lives elsewhere.

Given that, a syntax slot that looks meaningful but isn't is a liability: it suggests a check the compiler doesn't perform, and risks future grammar collisions (no current conflict, but `:` and `as` are precious). Dropping it costs nothing today and keeps the slot free.

## Migration

Existing test sites fell into three buckets:

- **Just remove it.** The body already produced the right type from typed inputs. Most reduce/over/repeat-while sites.
- **Move `as Type` inside the body.** Where a runtime cast was actually wanted on the return value. Higher-order tests.
- **Skip and revisit.** A handful of `types.test.js` cases needed deeper rework; deferred.

## Future work (not blocked by this)

- **Public-handler return type as interface contract.** Some future syntax — possibly `} : Type` revived for `@`-prefixed bindings only — declares the contract and is compile-time-checked against every body return point. Not yet wired.
- **Forward inference** (arg types + body → return type), the mirror image of the abandoned backward plan, may earn its keep for compile-time consistency on call sites: `result Text = fn(5)` could error if `fn(5)` is provably `Integer`. Same body-walking machinery as the backward plan; opposite direction. Worth the cost only when the runtime type-tracking story is more complete.
- **Runtime operator dispatch.** `function.test.js:155` exposes a gap: `(a, b) { a / b }` called with two `Float` args returns `1` instead of `1.5`. Tag is `Float`, math is integer. Independent of the syntax change, but the same generic-by-default model is what makes this gap matter.

## What this note replaces

An earlier version of this file described "one-hop bound" backward inference (declared return + body → param types). That design is abandoned. It was solving a problem the language doesn't have — private functions don't want compile-time param narrowing, they want polymorphic dispatch.
