---
created: 2026-11-25
---
# Fix: a positional destructure with too many names binds null

```brevity
two = () { return 1, 2, extra: 3 }
@go = {
  a, b, c = two()
  return result: c
}
```

Problem: this replies `re: [{}]` on js: `c` binds `null` with no error, though `two` has two positional values. For comparison, the matching arity works and ignores named keys (`a, b = two()` gives 1 and 2), and a mixed destructure works (`a, b, :extra = two()`). Not checked on rust or erlang.

Expected: naming more positional slots than the value has is a compile error where the shape is known (the callee's return), and an error at runtime otherwise, not a silent `null`.

Found probing a destructure for `kanban/board.bv`.
