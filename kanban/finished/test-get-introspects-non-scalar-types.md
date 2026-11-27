---
created: 2026-04-08
---
# Fix: test get should introspect non-scalar types

Problem: `test.get` on a function cell replies `re: [null]`: with `f = (n Integer) -> n`, `{ test: { get: '~f' } }` gets `{ re: [null], … }`.

Expected: it should report the function, most likely its signature (the service document's `["%f", sig…]` form, notes/opre-tagged-forms-2026-11-24.md).

Tests: __tests__/cam_test/get.test.js.

**Decided (2026-11-27):** `test.get` on a function replies its address, what the function is as a value (as replying `&f` gives), with its signature as its tag: `re: ["~f"], ty: [["%f", sig…]]`. js replying `&f` sends the address too.
