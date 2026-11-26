---
status: inbox
created: 2026-11-10
---
# Fix: in-process calls to an overload ignore arg types

Problem: calls between actors in the same process (parent to child, a file to itself, the test harness) send argument values without `ty` tags. For overloaded clauses, dispatch checks those values, but a value can only rule out a scalar param type: Integer, Text, Boolean, Float, Decimal, null. The guards also skip type matching for in-process senders: js `(from === '__parent' || from === '__self' || from === '__test' || …)` in src/codegen/javascript/classes.js; rust and erlang have the same bypass. The compile-time annotation check picks the first clause whose types accept the args, so at run time a different clause can run from the one the compiler judged.

## Repro 1: a parent calls a child's overload that differs only by type

```brevity
type Point (x Integer, y Integer)
type Box (w Integer)

T = (n Integer) *{
  @put = (p Point) -> v: 1
  @put << (b Box) -> v: 2
}

@viaPoint = {
  t = T(1)
  :v Integer = t.put(Point(1, 2))
  return :v
}

@viaBox = {
  t = T(1)
  :v Integer = t.put(Box(3))
  return :v
}
```

Problem: `@viaPoint` replies `v: 1`, correctly, but `@viaBox` replies `ex: { "viaBox": "error" }` (js, 2026-11-25; confirmed on all three targets earlier). The same call works when the class has a single `(b Box)` clause.

Expected: `@viaBox` replies `v: 2`.

## Repro 2: a file calls its own overload

```brevity
pick = (n Integer) { return "a" }
pick << (n Text) { return 1 }
@pk = (n Integer) { return "a" }
@pk << (n Text) { return 1 }
@g = (v Text) {
  return pick(v)
}
@h = (v Text) {
  return @pk(v)
}
```

Problem: on rust and erlang, `@g("z")` and `@h("z")` both reply `ex`. On js they reply `1` (2026-11-25).

Expected: both reply `1`.

## Fix

Expected: in-process sends carry `ty`, as wire sends already do (`genArgSlots` builds it for dependency calls), and an in-process overloaded call is matched by its tags. The value check stays as the fallback for untagged messages. A call whose args match no clause's types fails the same way as a call from outside.

To decide: should trusted in-process senders (`__parent`, `__test`) be type-matched too, or only `__self`?

Watch for:

- A `ty` on a message makes the receiver decode type-valued arguments from wire form: `_bv_unwire_packed` in js, `bv_unwire_*` in rust. Either serialize the arguments as wire sends do, or skip decoding for in-process messages.
- The send sites are js `#childSend`/`#childFire`, rust `child_*_dispatch*`/`handle_op_at`, and erlang `child_dispatch`/`*_handle_op` with `From = <<"__parent">>`.
- Not yet run: two clauses taking different classes, and rust parent calls into a file actor running as an instance of its own class (`handle_op_at(…, "__parent")`, where `__parent` isn't treated as in-process).

## Done when

Both repros and the "not yet run" variants pass on js, rust and erlang.
