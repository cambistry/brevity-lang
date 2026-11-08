# Session 2026-11-07 — a type in an instance's reply names the file as its authority

Closes point 5 of `notes/session-2026-11-03-ty-without-brackets.md`.

## Rule

A type is declared at the top of a file, so its authority is always a file actor. An instance
that sends a value of its file's type tags it `::Point`, relative to the file, and no parent between
the instance and the file adds its own address. The file-to-file parent still promotes it
(`Svc ::Point` at the caller). The bare `@` ("my class") and address translation in `re`/`op` are
unchanged.

```brevity
// svc.bv
::Point (x Integer, y Integer)

@W = *{
  @get = { return Point(1, 2) }
  @pair = { return (p: Point(1, 2), n: 1) }
}
```

| Reply       | Leaving svc.bv (all targets)              | At the caller                                 |
|-------------|-------------------------------------------|-----------------------------------------------|
| `@get`      | `ty: ['::Point']`                         | `ty: ['Svc ::Point']`                         |
| `@pair`     | `ty: { p: '::Point', n: 'Integer' }`      | `ty: { p: 'Svc ::Point', n: 'Integer' }`      |

Before this, JS sent `@W/1 ::Point`.

## Changes

- **JS `#_publishInstance` (`src/codegen/javascript/classes.js`):** `localTy` leaves a tag
  starting with `::` as it is.
- **Rust branch 6 (`handleTypedAssign_LocalInstanceVar`, `src/codegen/rust/statements.js`):**
  `p Svc::Point = q` where `q` is untyped used to send `as` to `q` as if it were an address. When
  `q` is a slot of a reply (`(p: q, n: k) = w.pair()`), it holds a value, and the bind failed.
  It now checks at runtime: a string is asked for the type, and anything else is checked in place
  with `bv_as`. JS and Erlang already did this.
- **Tests (`__tests__/classes/public_class_across_files.test.js`, "end to end: type values
  cross…"):** the relay records what the caller receives. The tests assert the exact `ty` leaving
  the file and at the caller, for a whole value and for a type nested in a named reply, and that
  the nested one decodes in the caller.

## Checked

- **A class nested inside an instance** (`In` declared in `W`, `W.@via` returns `In`'s `Point`):
  `::Point` on all three targets.
- **An instance constructed by another instance:** can't be reached yet (next point).

## Open: a class's actor returned from an instance

`@W = *{ @box = { return @Box(3) } }` (both classes of one file) is broken on all three targets.
None of them sends a `ty`, and none sends a usable `re`: JS sends `[{}]`, Rust
`["box__pub/1"]`, Erlang `[null]`. Whatever the class tag turns out to be, the rule above should
apply to it too: `@Box` is the file's class, so its tag is `@Box` relative to the file (no
`@W/1` in front). The `re` address is different, because the actor *does* live wherever it was
constructed. Needs: construction from an instance to publish the new actor, and a reply
`re: '#<…>'` plus `ty: '@Box'`.

## A field read on an untyped local

`r = w.get()` then `r.y`, or `(p: q, n: k) = w.pair()` then `q.y`, didn't compile on Rust or Erlang
(`Unsupported … DotAccessExpr on Identifier`). Nothing types `r` or `q`, so Rust and Erlang now
read the field off whatever value the local holds, as JS does:

- **Rust (`src/codegen/rust/expressions.js`):** `.get(field)` on an untyped `Identifier` or a
  chained `DotAccessExpr`.
- **Erlang:** a new runtime `bv_dot_(K, V)` (`src/codegen/erlang/preambles.js`) reads a map's
  field or an Object's named field, and `null` for anything else.

`r = w.pair()` (a two-field reply) still fails on every target, by design:
`notes/session-2026-10-29-remote-bind-single-value.md` binds the reply's single value. Use named
destructuring.

## Not done

- Whether `Svc ::Point` and `svc.bv ::Point` become one form belongs to the authority-checking
  design.
