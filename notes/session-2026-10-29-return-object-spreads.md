# Returning an Object spreads it — 2026-10-29

IMPLEMENTED, js / erlang / rust / browser. Test:
`__tests__/functions/return_object.test.js`. Closes the "erlang: `return r`
where `r Object`…" item in `session-2026-10-28-destructure-positional-fallback.md`.

## Decision

Returning a **sole Object-typed value** returns it as the reply: its
positional and named fields spread, exactly like `return ...r`. Both forms
agree:

```
f = (n Integer) { r Object = g(n); return r }   // reply = g's reply
f = (n Integer) { r Object = g(n); r }          // same
f = (n Integer) { r Object = g(n); return r, 7 } // r stays one value: [r, 7]
```

Why:

- **Round-trip.** `r Object = f()` binds the whole reply (10-28 rule). With
  spread, `r Object = g(); return r` forwards g's reply unchanged. Without it,
  binding then returning would change the reply's shape.
- **The validator already assumed it** (`knownReturnShape` treated a positional
  Object return as "names unknown").
- **The wire can't carry the alternative anyway.** A nested named-only Object
  (`[{x: 1}]`) reads back as named args, which is how js appeared to spread
  before: it emitted `re = [splat(r)]` / `bv-a: ["Object"]` (one positional
  Object) and the wire flattened it. A positional `r` came back nested, so js
  wasn't consistent either.

Only a statically `Object`-typed name counts (local `r Object = …` or param
`(r Object)`). An untyped or `Anything` value is returned as-is.

The two long-skipped tests in `core_types/structure.test.js` ("Object return
— bv-a coercion", expecting `[[100]]`) encoded the nested reading. Updated to
the decided behaviour (`[100]`, `[100, 200]`) and unskipped.

## Code

- `validate.js` `spreadObjectReturns` — lowers `return r` / tail `r` to the
  spread form before any check or backend runs. A lambda's return node is
  `Return`, a function's / handler's is `Reply`; the pass keeps that.
- `validate.js` `knownReturnShape` — an Object-typed identifier still in
  positional position is one value of several, so it carries no names: `:x =
  f()` against `return r, 7` is now a compile error. Untyped / `Anything` stay
  lenient.

Backend bugs exposed by the new cases:

- js `BvObject.pack`: a packed Object passed as the last argument was taken for
  the named-args dict (same class as the BvDecimal fix in
  `session-2026-10-29-untyped-param-arithmetic.md`).
- erlang: an Object nested in a reply (`return r, 7`) was emitted as the raw
  `{Pos, Named}` tuple → `null` on the wire. Now `bv_object_wire/1`.
- rust: `BvObject` had no `IntoValue`, so passing an Object as an argument or
  nesting it in a reply didn't compile. Spreads now go through `bv_val(&x)`,
  which also covers Object params (held as `Value`, no `.splat()`); the
  `<fn>_fn` helper's spread return likewise.

Also: dropped an unused `DOC_MANIFEST` import in `html/onclick.browser.test.js`
(lint warning).

## Open

- The nested-named-Object wire ambiguity itself (`[{x: 1}]` = one Object, or
  named args?) is unresolved. `bv-a` could disambiguate but packers ignore it.
