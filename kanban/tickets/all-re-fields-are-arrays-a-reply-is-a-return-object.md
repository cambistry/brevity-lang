---
status: done
created: 2026-11-19
---
# All `re` fields are arrays (a reply is a return Object)

Every reply's `re` is an array: the reply's return Object, with one entry per returned value. That includes a single value and a single address. No reply anywhere sends a bare `re`, whatever the sender: generated js, rust or erlang, the HTML host (src/codegen/browser/runtime.js), or the test harnesses.

Today the HTML host still answers some calls with a bare address, e.g. `first`, `body` and the element accessors:

```
    { id, re: '#<' + addr + '>', ty: 'HTML:' + el.localName, … }
becomes
    { id, re: ['#<' + addr + '>'], ty: ['HTML:' + el.localName], … }
```

Do:

- Wrap every remaining bare `re` in the host, and its `ty` to match.
- Check every target and runtime for other bare `re`: value replies, error replies, subscription replies (every `re` after the first), and replies the harnesses fake. Wrap any you find.
- Drop the leniency. `_bv_new_reply_addr` (js runtime/wire.js) loses its `strict` flag; there is one reading, and a bare `re` is malformed for every op, not just `$new`. Remove `done.strict` / `newResolve.strict` in classes.js and any bare-`re` fallbacks on rust (`bv_new_reply_addr`, `bv_wrap_address_reply`) and erlang (`bv_new_reply_addr_`, `bv_wrap_address_reply_`, `bv_self_reply_`). A wrap done only for a bare sender goes away.
- `_bv_reply_one` and the DomConstructor path read `re[0]` without needing to handle a bare `re`.
- Tests: dom tests that match bare `re` strings read `re[0]` or match an array. Add a test per target that a bare `re` reply is malformed (fails the call) for both `$new` and an ordinary call.
- Docs: CAM.md and the actors-not-classes note say a reply's `re` is always an array. Remove the "HTML host still answers bare" open item.

To decide:

- What a malformed reply does to the caller: throw/fail the awaiting call (the current `$new` behaviour) is the default.
