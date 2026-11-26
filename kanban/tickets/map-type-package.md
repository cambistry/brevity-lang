---
status: inbox
created: 2026-05-19
---
# Map type (package)

Design: notes/vocabulary-refactor-2026-05-15.md §6.

Want: a hash-keyed lookup primitive, distinct from Object: O(1) lookup, content-keyed (the BLAKE3 hash of the key's JCS canonical form decides equivalence), so a fresh `{a: 1}` finds an entry keyed by another `{a: 1}`, across the wire too. Compiles to JS Map, Rust HashMap, Erlang map.

Delivered through the library mechanism (`how-do-libraries-work-such-as-for-array-map`). Done when it exists on js, rust and erlang with core_types tests.
