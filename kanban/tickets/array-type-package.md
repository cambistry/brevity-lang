---
status: inbox
created: 2026-05-19
---
# Array type (package)

Design: notes/vocabulary-refactor-2026-05-15.md §7.

Want: a random-access ordered primitive, distinct from Object (linked) and Map (keyed): contiguous, O(1) indexed access, bulk data. Compiles to a JS Array, a Rust `Vec`, and whatever fits on Erlang.

Delivered through the library mechanism (`how-do-libraries-work-such-as-for-array-map`). Done when it exists on js, rust and erlang with core_types tests.
