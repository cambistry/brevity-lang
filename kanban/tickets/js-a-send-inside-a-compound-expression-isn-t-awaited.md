---
created: 2026-11-17
---
# Fix: on js, a send inside a compound expression isn't awaited

Problem: a dot call that sends a message, used as an operand, is emitted without `await`:

```
@R = (seed Integer) *{
  @call = {
    x Integer = @R.pubFn() + 1
    return x
  }
} ++ actor { @pubFn = -> 10 }
```

emits

```
const x__1 = _bv_int_op(this.#childSend((await this.#outerRead("~R__class", 2)), "pubFn"), '+', 1n);
```

and `call` replies `ex: { call: "error" }`. `x Integer = class.pubFn() + class::protFn()` replies `re: ["[object Promise]20"]`.

The same call alone on the right of a typed assign (`x Integer = @R.pubFn()`) is awaited and works. This happens before the `class` / `::` change too (checked on the stashed tree), and probably affects any actor's dot call, not just a class's: `k.n() + 1`.

Done when

- A send in any operand position (binary operators, call args, interpolation, conditions) is awaited on js, and a test covers each on js, rust and erlang (no target skipped).
- class_qualified.test.js's `@call` can go back to `x Integer = class.pubFn() + class::protFn()`.
