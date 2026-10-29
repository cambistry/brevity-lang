# Named destructure needs a named return — 2026-10-28

Follow-up to the two "bugs" logged in
`session-2026-10-28-delimited-class-star-body.md`. Both came from malformed
probes I wrote, not from the compiler.

## Rule

`:x T = f()` (and the key form `x: v T = f()`) destructures f's **named** `x`.
A sole positional result does not bind into a named pattern item. Bind it by
position: `x T = f()`. (`LANGUAGE_OVERVIEW.md` § call-site destructuring.)

## Change (uncommitted)

- `validate.js`: `knownReturnKeys` + `checkNamedReturns`. A destructure from a
  call whose returns are statically known, and carry no named `x`, is a compile
  error: "Cannot destructure 'x' from 'f()' — it returns no named 'x' (to bind a
  positional result, write 'x T = f()')". The callee can be a file-level
  function (via `localFunctionSigs`, which now keeps the fn node) or a method
  defined on an in-file class (resolved from the local's type, own methods
  only). Lenient whenever names can't be known: no inspectable return, a
  positional value that may be an Object (an Object spreads its names on js),
  spreads, inherited-only methods, or fns with no params (skipped by
  `localFunctionSigs`).
- Removed the runtime positional fallback for named/key pattern items: js
  `genDestructureAssign` (`namedOrFallback`, added with `@peer` in `9ee9b6e`)
  and the erlang named form. Rust never had it.
- Tests that leaned on the fallback, fixed to valid forms:
  `self/peer.test.js` and `self/peer_list.test.js` (`:a1 List = a.news()` →
  `a1 List = a.news()`); `classes/subclass_consumption.test.js` (`:result =
  u.b()` where `@b` returns `v` → `:v = u.b()`).
- New: `destructure/named_returns.test.js` (compile-time rejections, accepted
  forms, positional binds of class-method results incl. typed construction).

The valid replacement `a1 List = a.news()` (typed bind of a class method's
positional reply) was broken on two backends, hidden by the fallback:

- rust: `genRustTypedAssign` had no child-actor `DotCallExpr` branch (the
  statement dispatcher checks `TypedAssign` first, so the child branch below it
  only ever saw untyped `Assign`). It fell to the generic path, a
  fire-and-forget send yielding `Value::Null` (and a `cargo build` type error
  for scalars). Now routes to `genRustAssignChildDotCall` (which uses the
  declared type). Self-spawned refs (`a C = C()`) route through the destructure
  spawned-ref path as one positional item. That path also had its own copy of
  the fallback; it now reads named fields by name and positionals by index.
- erlang: a typed assign from a self-spawned ref bound the packed `{Pos, Named}`
  tuple. Now `bv_object_one(...)`, like the child-actor branch.
- rust: a typed construction of an in-file class, `a C = C()`, skipped
  `child_<c>_init` when the class had no params, so state initializers
  (`n *Integer = 7`) never ran and methods read `0`/null. Reproduced at
  `d93f740` with a valid named destructure. The typed path now also inits when
  the class has an `initBody`, matching the untyped path.

## Withdrawn

- `:result Integer = n + 1`: malformed. A scalar has no named fields.
- `:result Integer = double(21)` returning `0` on rust: also malformed (same
  rule). The now-reverted `BvObject::named_or_one` "fix" spread the leniency
  instead.

## Still open

- rust: a file-level generic private function with arithmetic,
  `double = (n) { n * 2 }`, fails `cargo build` (`&Value * &BigInt`). A generic
  fn compiles to a self-send op with `n: Value`, and the rust runtime has no
  dynamic arithmetic. Needs call-site monomorphization or a numeric-dispatch
  helper. js/erlang are fine; handler-local generic fns are fine on rust.
- erlang: `return r` where `r Object` holds named fields does not spread those
  names into the reply (js does). Divergence, not investigated.
- Mirror-image leniency on remote calls: rust `handleTypedAssign_DotCallExpr`
  and the erlang remote branch bind `x T = remote.m()` by reading the reply's
  named `x`, not its positional. Not touched.
- Bare `double(...)` for a public `@double`: rust resolves it to `@double`
  (`publicFnNames`), js treats it as a local value (correct per the language).

## Mirror rule: positional bind needs a positional

`x T = f()` binds f's positional result. When f returns only named fields it
does not bind them; pull them out with `:x T = f()` or `x: v T = f()`.
`validate.js` `checkPositionalReturn` rejects it where f's returns are known
(same resolution as the destructure check, via the shared
`knownReturnShape`). `x Object = f()` binds the whole reply and is exempt;
untyped `x = f()` is not checked. At `d93f740` this case failed at runtime on
all targets (js passed it for class methods only, by leniency); it is now a
compile error with a destructure hint.
