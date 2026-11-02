# Session 2026-11-01: `as` renders or fails

`as T` renders a value as T, or ends the enclosing call with an `ex`. Before this, it relabelled the
value on JS and Erlang, and on Rust a failed bind produced the type's default (`0`, `""`).

## The rule

A reply is an Object, so calls need no special case: `f() as Object` keeps the whole reply, and
`f() as Integer` unwraps a sole positional and checks it. `1 as Object` wraps. An actor is asked for
T with `[T, "as"]`.

| Value | `as Integer` | `as Float` | `as Decimal` | `as Text` | `as Blob` |
|---|---|---|---|---|---|
| Integer | yes | converts | converts | fails | fails |
| Float | if whole | yes | converts | fails | fails |
| Decimal | if whole | converts | yes | fails | fails |
| Text | fails | fails | fails | yes | yes |
| Blob | fails | fails | fails | yes | yes |

- **No parsing or stringifying.** Most uses of `as` are assertions, and `Svc.t() as Text` shouldn't
  pass on a wrong reply. Stringify with interpolation; parsing belongs in a named function.
- **The value is checked, never the `bv-a` tag.** The tag is the sender's claim and may be missing.
  JSON also turns `3.0` into `3`, which is why a whole Float passes `as Integer`.
- **null:** fails unless T includes it. `as Integer | null` passes.
- **Unions:** a member matching the value exactly wins, then the first that renders it.
- **Types:** checked by shape, deeply. Missing or wrong fields fail, extra fields are dropped. A value
  can arrive as a whole named reply, a positional list or a tagged value.
- **Not checked:** a class has no shape, and neither does a function type or a name this file doesn't
  declare, so `as` on those still only labels.

## Where the check runs

- **Any `as` the compiler can't settle.** One it can prove right emits nothing.
- **A typed bind from a remote reply,** with or without `as`, because a doc is only a claim. That
  includes `:a Integer = Svc.t()` and binds from actors. A local `x T = f()` is already proven by the
  return-path check, so it emits nothing.
- **A public handler's typed params,** because their tags are claims too.
- **Compile time:** `"x" as Integer`, `1.5 as Integer`, `null as Integer`, `"x" as Point` and
  `Point(1, 2) as Text` are errors. `Svc.t() as Integer` against a `Text` doc isn't, because
  overriding a doc is what `as` is for.

## Failure

The `ex` value says what was wanted and what arrived: `{ "@go": "as Integer: got Text" }`. It goes on
the enclosing call, and a call that receives one fails in turn, reporting `error`.

An actor with no clause for T fails with plain `error` on every target, since nothing rendered a
value to report on.

**It can't be caught.** `catch` is a label-based early exit, and nothing in the language handles an
`ex`. A failed `as` behaves like every other failure, and adding a handler is a separate decision.

## Code

- **`src/as_check.js`** runs last in `validate`, so every other check still reads `as` as written. It
  wraps what needs checking in an `AsExpr`. A call or actor source binds to a temporary first, so it
  keeps its typed-bind codegen, and the check reads the temporary.
- **Runtime:** `_bvAs` in JS, `bv_as/3` in Erlang, `bv_as` in Rust. Each takes the descriptor from
  `asDescriptor`.
- **Rust** converts strictly inside typed binds, destructures and public handler params
  (`G.strictConvert`), which is what stops it substituting defaults.

## Fixed on the way

- A class with only `self as` clauses wasn't treated as a class on any target.
- `x = Svc.t() as Object` was broken on all three targets: an unawaited promise on JS, `one()` on
  Erlang and a null on Rust.
- JS decoded an Integer param with `BigInt()`, which turned `true` into `1n`.
- `p Point = v as Point` compiled to `Point(v)`.
- **Rust, untyped `x = f()`:** bound the whole reply. It now takes the sole positional and fails on
  anything else, like JS and Erlang.
- **JS, an Object in a named reply field:** sent `{positional, named, …}` on the wire. It now sends
  `[1]` or `{a: 1}`, like Rust and Erlang.

## Known gaps

- **Empty list on JS:** `null` is JS's empty list, so `null as List` from a remote passes there and
  fails on Rust and Erlang. A literal `null` is a compile error on all three.
- **Rust arithmetic on untyped operands** reads them with `.as_i64().unwrap_or(0)`, so `(a + b) as
  Integer` with a Text operand should give a number rather than fail. That default is in the
  arithmetic, before `as` sees a value. Read from the generated code, not run.
- **A public handler with an empty body** gets no param check on JS or Erlang, since a trailing check
  would become the reply. Rust's decode still fails, and JS's does for Integer.
- **Nested failures in Erlang instance processes** report `error`, not the `as` message.
- **`Anything` params:** the separate bug where a param typed `Anything` refuses a `Text`-tagged
  argument is still open, so the Type tests go through a remote reply.
