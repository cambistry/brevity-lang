---
created: 2026-11-27
---
# A reply of an own function's call loses its type

```brevity
type Point(Integer, Integer)
first = (p Point) -> { return p }
@ctl = {
  q = Point(6, 6)
  return first(q)
}
```

`ctl` should reply `{ re: [[6, 6]], ty: [':Point'] }`. On js it replies the internal form
(`{ 0: 6, 1: 6, __type: ':Point' }`) with no `ty`; on erlang the value is right but `ty` is missing.
The reply's type is the called function's inferred return type; the reply path doesn't read it.

Done when a handler returning an own function's result replies that result in its wire form,
with its tag, on js, erlang and rust, with a test.
