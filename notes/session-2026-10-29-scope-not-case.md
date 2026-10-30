# Session 2026-10-29 — type vs. name by scope, not capitalization

The parser and validator no longer read capitalization. The rule (decided
2026-10-29): a type name in scope is reserved, so no param, local or binding
may share it. A lone name is a type if one by that name is in scope, otherwise
a local. In scope: built-ins, the file's `::` types, classes and coercions
(`C = Svc as …`), and every name the header binds. It is settled after parsing
(`resolveLoneNames`), so a type declared later in the file counts.

## Genuinely ambiguous sites — now resolved by scope

- **Destructure `key: X = f()`** — parsed as `{ named, name: key, type: X,
  typeOrLocal }`; after parsing, X not in scope ⇒ `{ key, name: X, type: null }`.
  `isDestructureStart` no longer splits on case: `key: X = …`, `key: X, … = …`
  and `key: local Type = …` are all destructures. A destructure local that
  names a type in scope is an error ("a type name is reserved").
- **Public constant `@x = Name(…)`** — any call is taken speculatively as a
  constant; after parsing, a callee that isn't a type in scope throws the
  existing "only functions can be public" error (what `@x = f(1)` gave before).
- **Types inferred from a callee** (`c = Counter()` state vars, implicit
  returns) — inferred from any callee, then dropped to `Anything` / no type
  when the callee isn't a type in scope.
- **Lineal class detection** (`isActorBodyStart`) — the "capitalized name ⇒
  class body" signal is gone. A lineal class without the `*…*` header is
  recognised only when its body opens with `@` / `self` / `set` / `update`.
  `__tests__/operators/set.test.js`'s `Counter` relied on its capital and now
  uses the `*` header like the classes around it.

## Type-position guards — dropped (already unambiguous)

Union members (`| X`), `&X` after a param name, `Type = default` in
`peekIsType`, `<X …/>` at primary position, `as X`, `*name` (a ref grant iff
`name` is a ref cell; types are reserved so they can't be refs), sigil/positional
destructure types (`:a X`, `a X`), the destructure scan, and the typed-assign
comma RHS (`p Point = 1, 2`).

## Validate

- `::point` is legal — the "type name must start with an uppercase letter"
  check is gone (test flipped to assert acceptance).
- `unknownBareType` polices lowercase bare names too (excluding `null`).
- Cross-module `Alias::Name` matching uses `\w+` on both sides.

## Not touched

- Lexer: `<div` (lowercase letter after `<`) lexes as an HTML element. That's
  HTML's own convention, not a Brevity type/name decision.
- Codegen had no capitalization checks.

## Tests

`__tests__/destructure/lone_names.test.js` (new). Scoped JS runs green:
destructure, classes, types, syntax, functions, values, operators, xml, html,
cam, services, keywords, literals, self. Rust/erlang/browser and the full suite
not run.
