# File singleton header (`**`) — 2026-11-13

Follows `classes-as-singletons-2026-11-09.md` ("Files: the header declares the file's kind").

**2026-11-17:** the braced `**{ … }` is now the actor literal `actor { … }`; see `actor-literal-2026-11-17.md`. The lineal `**` header is unchanged.

## Forms

```
**                         ( DI ) actor {
  :document                  body
  HTML: (:div)             }
**
body
```

- Lineal: `**` alone on its line opens, `**` alone on its line closes. The closing `**` may be
  followed by `{ body }`.
- Delimited: `( DI ) actor { body }` (an optional `->` before `actor`, as with `*`).
- No DI: `**\nbody` or `actor { body }`.
- Entries have the same grammar as the `*` header.
- Remote DI doesn't change: `"/lib.bv": Lib` consumes an `actor { … }` file.

## Rules

- **Head of the file only.** DI is the host filling the file in at load. An inline singleton has
  nobody to fill it, so `**` anywhere else in a file is an error (`a file header must open the
  file`). This includes after a `type` declaration: a type that sat above a `*` header goes below the
  `**` header.
- **Kind on the AST:** `ast.fileKind` is `'singleton'` for a `**` header or no header, and
  `'factory'` for a `*` header. Nothing reads it yet.
- **A `*` header takes no DI.** It makes the file a factory, and its entries are `new`'s params:
  positional, named, renamed, published, defaulted. Any dependency entry is a parse error that names
  it and points to `**`: a path, `#`, a declared constructor, a destructure, `:name`, or an untyped
  key (`HTML: Html`, which resolves to a dependency). The check runs after untyped keys are
  resolved.

## Open

- **`#` on header entries.** `"svc.bv": Svc #` (something to construct from) is the importer saying
  what the file is. Once a file's doc carries its kind, `#` becomes either a check against it or
  redundant. The service document doesn't carry the kind yet.
- ~~**The two-section layout**~~ for a factory with class-level state: a `**` header, members, then
  a `*` section as the file's `new`. See `class-singleton-forms-2026-11-13.md`.
