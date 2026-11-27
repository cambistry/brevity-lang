---
created: 2026-11-27
---
# js: an empty List equals null

On js the empty List is held as null (a list is `{ head, tail }`, ending in null), so `xs == null` is true for `[]`:

```brevity
use Svc = "svc.bv" as { maybe () -> (List[Integer] | null) }
@g = {
  xs List[Integer] | null = Svc.maybe()
  return xs == null
}
```

Sent `re: [[]]`, js replies `true`; erlang and rust reply `false`. A List arriving from another actor is told from null on its wire form (`_bvWireList`, see null-as-list-from-a-remote-passes-on-js), but once held, the two are the same value on js.

Want: `[] == null` is false on every target, and a `List | null` value remembers which it is.
