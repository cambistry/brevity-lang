---
created: 2026-11-25
---
# `|>`, the pipe

Design: `notes/pipe-and-clause-lists-settled-2026-11-26.md` (the `|>` section). The first of three pieces split from the clause-lists work; then `clause-lists-callable-lists-with-pattern-heads` and `arrow-functions-take-bare-comma-params`.

Today: there's no pipe. `1 |> inc` fails with "Expected a line break or ';' after a statement, got PIPE": the lexer emits `|` as `PIPE` (src/lexer.js:654) and `>` separately.

Want: `v |> f(a)` is `f(v, a)`.

- Lowest precedence of the binary operators, left-associative: `v |> f |> g(a)` is `g(f(v), a)`; `a + b |> f` is `f(a + b)`.
- A bare callee takes the value alone: `v |> f` is `f(v)`.
- Member, remote and writing calls work the same: `v |> svc.lookup(a)`, `v |> add!(a)`.
- A line may start with `|>`, continuing the previous line.
- Anything else on the right of `|>` (a literal, an unbound name) fails where it's met.

Watch: `|` already serves type unions, `|params|` delimited functions and the `<T |>` type syntax (`__tests__/classes/subclasses.test.js:109`), which must keep working.

Tests: runtime cases on js, rust and erlang for a call, a bare callee, a chain, a member call, a remote call and a line-leading `|>`; compile-error cases for a non-callable right side.
