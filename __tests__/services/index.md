# Services / Host API

LLM orientation: this directory covers host-facing compiler interfaces, not only
source-language syntax.

## Public Host API

- `extract(source)`: parse source and return `ast` plus interface metadata.
- `compile(ast, options)`: validate an AST and emit target code.

This split lets a host inspect dependencies, resolve remote service documents,
and then compile with the resolved context.

## Tested Areas

- `extract.test.js`: AST/interface return shape, params rendering, service
  rendering, unresolved remotes, extract-to-compile round trips.
- `interface.test.js`: public handler signatures, silent functions, overloads,
  optional args, private helper exclusion.
- `constructor_interface.test.js`: public class signatures and the actor
  method surfaces they produce.
- `subclass_interface.test.js`: subclass class surfaces, parent spreads,
  multi-parent rendering, and wrapped parent marker hiding.
- `dependency_injection.test.js`: file-level dependency declarations and
  outgoing CAM messages.
- `interface_notation.test.js`: service-document entry forms, retired forms,
  read-only fields, constructor profiles in source.

## Service Document Notation

One entry per line (or comma-separated). Each entry is a name, a space, and a
definition: no entry colon, no `=` on types.

```text
{
  ::Point (x Integer, y Integer)          type declaration
  add (a: Integer, b: Integer) -> (sum: Integer)
  clone () -> (Node)                      overloads: one line each,
  clone (deep: Boolean) -> (Node)         repeating the name
  log! (Text) -> .                        silent
  Counter (start: Integer) -> *{          constructor; body always written
    get () -> (value: Integer)
  }
  Text (Node |) -> *{}                    supertype, no members of its own
  set label (Text)                        settable field
  count *Integer                          ref cell (readable and settable)
  total Integer                           read-only field
}
```

The `->` before a return or `*{` is optional on input and always emitted.
Returns are always parenthesized (or `.`). Colons inside parens still mark
named params and fields.

The same constructor profile appears in source:

```brevity
*
  "thing.bv": Thing (a: Integer) -> *{ get () -> (value: Integer) }
*
Coerced = Other as (a: Integer) -> *{ get () -> (value: Integer) }
```

## LLM Rules

- Public service documents omit `@` from handler names.
- Entries have no colon: `name (params) -> (returns)`, `Name (params) -> *{ … }`.
- Silent handlers render as `-> .`.
- Optional args render with `?`.
- Private `#name` and bare helper functions do not appear in service docs.
- Public classes use `@Name = ...` when they should be exported through the
  service interface.

## Documents

- [`extract()`](extract.md)
- [File-Level Dependency Injection](dependency_injection.md)
