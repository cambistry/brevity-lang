# Session 2026-11-01: return paths with different types

```
@f = (b Boolean) { if b { return 1 }; return "x" }

f (Boolean) -> (Integer | Text)
```

## Decisions

**Merge paths with the same slots, alternate the rest.** So one set of paths has one spelling.

| Paths | Doc |
|---|---|
| `return 1` / `return "x"` | `(Integer \| Text)` |
| `return n: 1` / `return n: "x"` | `(n: Integer \| Text)` |
| `return a: 1` / `return 2` | `(a: Integer) \| (Integer)` |
| `return 1` / `return self` | `(Integer) \| self` |

Slots are the same when they have the same count and the same names in order. `self` stays last.
A doc, and a function type, can state any of these by hand.

**A path whose type can't be inferred widens to `Anything`,** which absorbs its union:
`if b { return x }; return 3` with an untyped `x` is `(Anything)`. It used to be `(Integer)`, which
could be false. It prints positionally, with no `arg1:` label, a name no path ever had.

**A caller's annotation has to hold for every path.**

```brevity
x Integer = f(true)            // error: it can return Integer | Text
x Integer | Text = f(true)     // ok
x Integer = f(true) as Integer // ok: you've said so
```

- **Applies to:** a function in this file, a class's method, and a doc's entry. Single shapes count
  too, so `x Text = Svc.f()` on `(Integer)` is now an error. Nothing checked that before.
- **A destructured key has to be in every shape,** and its type has to hold in each.
- **A path that returns only names, or self,** can't bind to `x T`.

### Left unjudged

These pass, because there's nothing reliable to compare:

- A slot typed `Anything`, or an annotation of `Anything`.
- A type the file knows nothing about, or a class with `as` clauses, which can convert.
- A function with overloads: the args pick one, and this check doesn't resolve them.
- A value that isn't a direct call: `x Integer = y`, or a call nested in an expression.

### `as` is the escape, and it's checked at runtime

`x T = f() as T` is how a caller takes one type out of a union. The return-path check doesn't judge
it, because `as` settles it at runtime: a wrong value ends the call with an `ex`. See
`session-2026-11-01-as-renders-or-fails.md`.

## Code

- **`src/return_shapes.js`:** `returnPaths` moved from `index.js`, plus `returnShapes` (from a
  function), `docReturnShapes` (from a doc entry) and `fieldAcrossReturns`.
- **Doc entries:** `returns` stays the first shape, and `returnAlternatives` lists them all when
  there's more than one. Each `returns`-reading consumer now handles that: a key is inferred only if
  it's in every shape, and `classes.js` doesn't take a union with a scalar in it for an actor type.
- **`checkAnnotationCovers`** in `validate.js`.

## Bugs fixed on the way

- **Rust, Erlang:** `x T = Svc.f()` on a service didn't wait for the reply, and bound `null`. Only
  destructures and calls on an instance did.
- **Test fixtures that were wrong all along,** now caught: `bang.test.js` bound `v Integer = helper()`
  to a function returning only a name, and `grapheme_text.test.js` destructured `:result` from a doc
  that said positional. `remote_call_binds.test.js`'s `x T = r.m()` on a named-only doc is now a
  compile error rather than a runtime one.

## Tests

`__tests__/functions/return_shapes.test.js`.

## Verification

Full js project; the DOM tests in `__tests__/html`; and on Rust and Erlang, every test file using a
dependency (33 files) plus those changed. The full suites were not re-run, after the system stopped
an earlier run for low memory.
