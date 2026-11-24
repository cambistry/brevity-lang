---
status: done
created: 2026-11-18
---
# Retire the trailing `*` section; a singleton file's constructor is `new =`

Design: notes/use-di-2026-11-17.md ("Factory files and the trailing `*` section"); class-singleton-forms-2026-11-13.md

Land before (or with): `use` statements replace the DI header

Summary

A lone `*` section after singleton lines (members, then `*` params `*` as the file's `new`) is retired. A singleton file that builds instances declares `new` like any singleton, using the existing lineal form. A `*` at the head of a file is unchanged and still makes a factory.

```
count *Integer = 0

new =
*
  seed Integer
*
count <- count + 1
```

Semantics

- The file is a singleton, or 'class' when it declares `new`. Factory files (lineal `*` header, `*{ … }`, `( params ) [->] *{ … }` at the head) are unchanged.
- The `new =` body is an ordinary lineal body: it ends at the first blank line unless held open by `--` or braces. (The `*` section ran to the end of the file.)
- The wire should be unchanged: `$new` to the file builds one, at `n` under the file, with `ty` `.`. Verify against today's two-section output.

Errors

- A lone `*` after singleton lines: parse error, "a singleton's constructor is declared with `new =`".
- A dependency entry (path, `#`, `:name`, destructure) in a `new =` constructor's `*` params: parse error, "a constructor's params take no DI; declare it with `use`".

Work

- Parser: remove the `fileNewSectionOk` `*` section (src/parser.js) and add the errors above. Make sure `new =` with a lineal `*` works at file top level (today's tests use it inside a nested singleton).
- Migrate two-section files to `new =`. Add `--` or braces where a constructor body has blank lines.

Tests

- A file-level `new =` lineal constructor; instances built via `$new` match the old wire shape.
- `new =` closing over file members.
- A constructor body held open with `--`.
- Factory files in all three head forms still parse and build as before.
- Both errors.
