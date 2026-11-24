---
status: inbox
created: 2026-11-10
---
# overloaded clauses that differ only by class or type params can't be told apart for in-process calls

Calls between actors in the same process (parent to child, a file to itself, the test harness) send argument values without ty tags. For overloaded clauses, dispatch checks those values, but a value can only rule out a scalar param type: Integer, Text, Boolean, Float, Decimal, null.

When clauses differ only by class or type params, the call goes to the first clause that matches by arity. When that's the wrong clause, the handler errors. Confirmed on js, rust and erlang. The same call works when the class has a single (b Box) clause.

**Repro:**

```
::Point (x Integer, y Integer)
::Box (w Integer)

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

@viaPoint replies v: 1, which is correct. @viaBox should reply v: 2, but it replies ex: { "@viaBox": "error" }.

**Fix:** in-process sends carry ty, as wire sends already do (genArgSlots builds it for dependency calls), and an in-process overloaded call is then matched by its tags. The value check stays as the fallback for untagged messages.

**Watch** **for:**

- A ty on a message makes the receiver decode type-valued arguments from wire form: _bv_unwire_packed in js, bv_unwire_* in rust. Either serialize the arguments as wire sends do, or skip decoding for in-process messages.
- The send sites are js #childSend/#childFire, rust child_*_dispatch*/handle_op_at, and erlang child_dispatch/*_handle_op with From = <<"__parent">>.
- Not yet run: two clauses taking different classes, a file calling its own handler overloaded on types, and rust parent calls into a file actor running as an instance of its own class (handle_op_at(…, "__parent"), where __parent isn't treated as in-process).

**Tests:** the repro above on all three targets, plus the variants listed under "Not yet run".
