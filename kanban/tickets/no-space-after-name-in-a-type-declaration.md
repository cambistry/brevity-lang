---
status: queued
created: 2026-11-26
---
# no space after name in a type declaration

type Point(Integer, Integer)

It should be parsable with whitespace after the type name, but tests, examples and real code should generate without the space.
