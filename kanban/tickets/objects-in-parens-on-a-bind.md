---
created: 2026-11-02
---
# Fix: parens around an Object should work on a bind

Problem:

Parens around an Object work in reply position but not on a bind. `return (x: a)` and a tail `(a, b)` parse, and `x = 1, 2` and `x = a: 1` parse, but these all fail with `Expected RPAREN, got COMMA` or `got COLON`:

```
x = (1, 2)
y = (a: 1)
x Object = (1, 2)
x Object = (a: 1)
```

The unparenthesized typed form also fails: `x Object = a: 1` gives `Unexpected token in expression: COLON`, while `x = a: 1` and `x Object = 1, 2` work.

Expected:

On a bind, parens around an Object mean the same as the bare form. Parens with a top-level comma, a `key:` or a `:name` hold an Object. Anything else in parens stays grouping.

Done when:

- These bind the same Object as their bare forms on JS, Rust and Erlang, typed and untyped: `(1, 2)`, `(a: 1)`, `(:a)`, `(:a, :b)`, `(1, b: 2)`.
- `x Object = a: 1` works.
- `(1)` and `(a + b)` still mean the plain value.
- `(a: 1) { … }`, `(a: 1) -> …` and `(a: 1) *{ … }` are still a function or class.
- A destructure from a parenthesized Object works, for example `:a, :b = (a: 1, b: 2)`.
- Tests in core_types/structure_literal.test.js cover each form, including reading the values back on each target.

Notes:

The parse path is `parseRHSObjectLiteral` in src/parser.js. Only the failing forms above were tried, on JS, so the other forms in "Done when" are expected behaviour rather than confirmed.
