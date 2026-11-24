---
status: done
created: 2026-11-15
---
# Op arg lists always bracketed: retire the bare `{k: v}` payload

Design: notes/op-args-always-bracketed-2026-11-15.md

An `op` arg list must always be an array. A payload of named fields only, `[{ url: "…" }, "get"]`, becomes `[[{ url: "…" }], "get"]`. Positional args, and positional args followed by named fields (`[[pos1, {k: v}], "f"]`), are unchanged, as is a bare op name (`"ping"`).

Each `op` element is then typed by its JSON type alone: a string is an op name, an array is an arg list, an object is reserved for subops. Each message also has a single encoding, which canonical-JSON digests need.

Scope:

- JS, Rust and Erlang runtimes, plus src/codegen/browser/runtime.js: stop accepting an object as the payload.
- Codegen in all three targets: emit `[{…}]` for calls with named args only.
- `ty` gets the matching bracket (`[[{ url: "Text" }]]`).
- Update the wire expectations in the tests.
- Update the examples in docs/CAM.md and docs/self-sends-implementation.md.

Done when: no target emits or accepts a bare-object payload, and the affected tests pass on js, rust and erlang.
