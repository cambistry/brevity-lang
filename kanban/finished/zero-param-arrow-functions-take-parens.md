---
created: 2026-11-26
---
# Zero-param arrow functions take `()`

Design: `notes/clause-lists-2026-11-25.md`, "Arrow params"; kept as design and built on its own by `notes/pipe-and-clause-lists-settled-2026-11-26.md`.

Today: a zero-param arrow function is written `-> 123`, as in `@get = -> x`. Tests alone have about 1,550 `= -> ` sites.

Want: `() -> 123`, never `-> 123`. A block body needs nothing: `{ … }` is already a function. Members too: `@slug = () -> slug`. `-> x` with no params fails as an ordinary parse error.

Decide: how to do the migration across tests, docs and `.bv` sources (a mechanical rewrite, checked by the full suite).

**Decided (2026-11-26):**

- **Migration:** a mechanical rewrite. A `->` whose previous token is `=`, `(`, `,`, `[`, `{`, `:`, `|>`, `<<`, `>>`, `return` or the start of a line becomes `() ->`, across `__tests__`, `docs`, `agent-resources`, `.bv` sources, the `LANGUAGE_*` docs and Brevity in `src` messages and comments. `notes/` stays as history. The full suite checks it.
- **Bodies:**

  ```brevity
  -> {}      // not legal
  () -> {}   // legal
  x -> {}    // legal
  x {}       // not legal
  (x) {}     // legal
  ```
- **A lineal body's `-> expr` becomes `return expr`** (the `=` alone on the line before it). That `->` isn't a function's arrow: the lineal header holds the params, and `return` is a body's value-return spelling.
