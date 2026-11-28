---
created: 2026-11-25
---
# Fix: on js, `test.get` on a list cell replies the internal linked-list form

```brevity
l *List of Integers = [1, 2]
@read = { return l }
```

| Message | js | rust, erlang |
|---|---|---|
| `{ test: { get: '~l' } }` | `re: [{ head: 1, tail: { head: 2, tail: null } }]` | `re: [[1, 2]]` |
| `read` | `re: [[1, 2]]` | `re: [[1, 2]]` |

Problem: both carry `ty: ['List of Integers']`. Only js `test.get` leaks: the `get` branch of `#_test` (src/codegen/javascript/classes.js, the generated runtime around :1378) posts the cell's raw value, converting only `Object` cells, while a normal reply goes through the wire conversion.

Done when `test.get` on a cell replies the same value a handler returning that cell does, for every type (List, Object, a user type, an actor), with tests in __tests__/cam_test/get.test.js run on js, rust and erlang.

**Scope (2026-11-27):** every target, not js alone: erlang replied a user type's internal map and
`null` for an Object; rust replied a user type unwrapped and an actor's internal ref, and failed to
build an Object cell (`to_json`); js replied an actor raw, and a handler replying an Object cell
failed (no `BvObject` in the program). `test.get` now gives its value the reply's wire form, its
held actors their names, and its Text the wire escape.
