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
- `constructor_interface.test.js`: public constructor signatures and instance
  method surfaces.
- `subclass_interface.test.js`: subclass constructor surfaces, parent spreads,
  multi-parent rendering, and wrapped parent marker hiding.
- `dependency_injection.test.js`: file-level dependency declarations and
  outgoing CAM messages.

## LLM Rules

- Public service documents omit `@` from handler names.
- Silent handlers render as `-> .`.
- Optional args render with `?`.
- Private `#name` and bare helper functions do not appear in service docs.
- Public constructors use `@Name = ...` when they should be exported through the
  service interface.

## Documents

- [`extract()`](extract.md)
- [File-Level Dependency Injection](dependency_injection.md)
