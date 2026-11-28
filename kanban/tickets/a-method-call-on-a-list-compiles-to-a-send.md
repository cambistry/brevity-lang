---
created: 2026-11-27
---
# A method call on a List value compiles to a send

```brevity
@go = {
  xs List[Integer] = [1, 2]
  return xs.map((x Integer) -> x + 1)
}
```

Compiles, and on js becomes `this.#childSend(xs__1, [["#<:@0>"], "map"])`: a message to the list,
as if it were an actor. The reply is `ex: { go: 'error' }`. `map` isn't a List method (the forms
are `List.f(list)` and the bang forms on a list cell), so this should be a compile error naming the
missing method, as an unknown method on any value type is.

Done when calling a name that isn't a method of the receiver's value type fails to compile, with a test.
