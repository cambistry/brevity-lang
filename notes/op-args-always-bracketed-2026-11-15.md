# Op arg lists are always bracketed — 2026-11-15

Status: **proposal.** Prerequisite for [op chains](opre-op-chains-2026-11-15.md) and
[subops](opre-subops-2026-11-15.md).

## The rule

An arg list in `op` is always an array. The bare named-fields form `{k: v}` as a whole payload
is retired; write `[{k: v}]`.

| Today | Proposed |
|---|---|
| `[{ url: "https://example.com" }, "get"]` | `[[{ url: "https://example.com" }], "get"]` |
| `[{ path: "/main" }, "$new"]` | `[[{ path: "/main" }], "$new"]` |
| `[[pos1, pos2], "f"]` | unchanged |
| `[[pos1, pos2, { k: v }], "f"]` | unchanged |
| `"ping"` | unchanged |

Inside an arg list nothing changes: positional args, then an optional trailing named-field
structure `{k: v}`. Positional args already require brackets (`[[100], "$set"]`, never
`[100, "$set"]`); this brings the named-only case in line.

## Why

- **Each `op` element's JSON type says what it is:**

  | Element | Meaning |
  |---|---|
  | string | op name |
  | array | arg list for the op name that follows |
  | object | subop ([subops](opre-subops-2026-11-15.md)) |

  The bare `{k: v}` payload is the one thing in the way: it makes an object mean "arg list".
  With it gone, an object in `op` is always a subop.
- **One spelling per message.** The shorthand gave named-only calls two encodings. Messages are
  digested under canonical JSON (JCS), which normalizes key order and numbers, not shape, so
  two spellings of one call hash differently.

## `ty`

Unchanged in principle: `ty` mirrors `op` with the op names removed. A named-only call's `ty`
gains the same bracket: `ty: [[{ url: "Text" }]]`.

## Scope of change

Every place that reads `op[0]` as a payload and accepts an object there: the JS, Rust and
Erlang runtimes and `src/codegen/browser/runtime.js`; codegen that emits named-only calls; wire
expectations in the tests; the examples in `docs/CAM.md` and `docs/self-sends-implementation.md`.
