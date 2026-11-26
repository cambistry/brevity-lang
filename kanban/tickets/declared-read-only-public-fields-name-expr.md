---
status: inbox
created: 2026-10-29
---
# Declared read-only public fields (`@name = expr`)

Today: a class can't publish a read-only value computed from an expression, and has no read-only public field of a base type.

| Declaration | Today | Service document (JSON) |
|---|---|---|
| `@n *Integer = 0` | public cell, read and set | `n` read, plus `:n` with `$get` and `$set` |
| `@p *Point = Point(1, 2)` | public cell, read only (setters are made only for base types) | `p` read, plus `:p` with `$get` only |
| `@k = 5` | public constant (literal or constructor call) | `k` read only, no cell entry |
| `@title = label` | "'@title' is public — only functions can be public…" | — |
| `@title Text = label`, `@k Integer = 5` | parse error ("Unexpected token after '@title'") | — |

Want: `@name = expr` declares a read-only public field, evaluated at construction; a read replies with the value positionally.

- Service document: `title` as a read, plus a `:title` entry with `$get` only, as `@p *Point` has today.
- `t Text = c.title()` binds positionally; `c.title <- "x"` is a compile error.
- `sub c.title, (v) { … }` works as on any read-only field.
- Subsumes `@k = 5`, which gains the same `:k` entry.

```brevity
C = (label Text) *{
  @title = label                 // read-only public field
  @n *Integer = 0                // unchanged: readable and settable
}
```

Decide:

- Snapshot at construction, or a live derived field when `expr` reads a cell (overlaps notes/capability-sigils-2026-05-16.md)? Snapshot is simplest.
- An optional annotation, `@title Text = label`, for coercion or documentation; today a parse error.
- Parsing: a handler needs `->`, `{` or `(params)` after `=`, so a bare expression can be a field.

Done when `@title = label` compiles on js, rust and erlang: read binds positionally, set is a compile error, the service document has the `$get`-only entry, and `@k = 5` matches. Tests: read, rejected set, sub, service-document extraction.
