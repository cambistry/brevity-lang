---
status: inbox
created: 2026-04-08
---
# test get introspects non-scalar types

`test.get` on a function cell replies `re: [null]`: with `f = (n Integer) -> n`, `{ test: { get: '~f' } }` gets `{ re: [null], … }`. It should report the function, most likely its signature (the service document's `["%f", sig…]` form, notes/opre-tagged-forms-2026-11-24.md).

Tests: __tests__/cam_test/get.test.js.
