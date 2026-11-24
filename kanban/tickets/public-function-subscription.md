---
status: done
created: 2026-04-19
---
# public function subscription

Universally supported with `address`.op.subscribe.

---

OUTDATED THOUGHTS:

Maybe two syntaxes to support. Direct:

```
@closure = {{ ... }}
```

And indirect:

```
closure = { ... }
@closure = { &closure }
```

One can invoke the closure to evaluate:

```
{id: "123", op: "eval@closure" ...} // ? "call?"
```

And one can send a `subscribe` op to such a named closure directly:

```
{id: “123”, op: “subscribe@closure” …}
{id: “123”, re: <value> …}
```

Discuss.
