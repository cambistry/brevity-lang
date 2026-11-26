---
created: 2026-11-22
---
# The parser produces encoded types

Every type position in the AST carries the encoding from ticket 1, built once by the parser: params, cells, `as`, `of`, reply shapes, declared types' fields, interfaces. Validation, the effects check and the singleton/class passes read the encoding.

- No compiled output changes. No wire message changes.
- These passes no longer parse a type string.

Done when: the full suite is green with the compiler's analysis passes reading only encoded types.
