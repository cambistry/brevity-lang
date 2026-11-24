---
status: done
created: 2026-11-22
---
# Encode a Brevity type as an Opre type

Add one module that turns Brevity type notation into the encoding in notes/opre-type-encoding-2026-11-21.md ("Types", "Addresses"). Nothing uses it yet.

- A type is an address string: "Integer", ":Point" for the file's own type, "svc:Point" for a type reached through another service.
- A generic is its parameters then a %t entry: [["Integer"], {"%t": "List"}]. Named parameters go in the %t entry. A nested list is "any number of".
- Optional is {"%opt": T}.
- Params, reply shapes and a declared type's fields encode as entry lists, written as `ty` writes them: positional entries are items, named entries sit in an object.
- A class or actor in a type position encodes as its address (":T:*" for an instance).

Done when: unit tests cover every type form the parser accepts today, including function-typed and actor-typed params, each compared to a literal encoding.
