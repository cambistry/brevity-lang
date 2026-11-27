---
created: 2026-11-26
---
# Fix (js): a list arg from the wire is not a list

A handler with a list param, sent a list from outside, fails on js; erlang and rust reply:

```brevity
@sum = (xs List[Integer]) {
  r Integer = reduce(0, xs) (acc Integer, x Integer) { acc + x }
  return r
}
```

```js
{ input: { id: '1', op: [[[1, 2, 3]], 'sum'], ty: [['List[Integer]']], from: 'c' } }
// js: { id: '1', ex: { sum: 'error' }, to: 'c' }; erlang, rust: re: [6]
```

The js runtime holds a List as a linked list (`{ head, tail }`), and the wire array is never converted. The handler's arrival check (`src/as_check.js`, `checkParams`) emits `_bvAs(xs, {"l": "Integer"}, …)` as a statement: `_bvAs` returns the converted list, and the result is dropped. Fails the same before the `List[…]` spelling change (checked at 93fa852 with `List of Integers`). No test sends a list arg over the wire today.

Expected: a list arg arrives as a list, on all targets, nested lists included.
