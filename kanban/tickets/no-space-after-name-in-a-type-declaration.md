---
status: queued
created: 2026-11-26
---
# no space after name in a type declaration

type Point(Integer, Integer)

It should be parsable with whitespace after the type name, but tests, examples and real code should generate without the space.

**Decided (2026-11-26):** it already parses. The work is generation: tests, docs and examples, and
what the compiler prints (messages like `'type P (…)'`), all without the space. The service
document's text notation too, though that protocol has been overhauled, so it matters little.
