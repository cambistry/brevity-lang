---
status: inbox
created: 2026-11-25
---
# A positional destructure with too many names binds null

```brevity
two = () { return 1, 2, extra: 3 }
@go = {
  a, b, c = two()
  return result: c
}
```

replies `re: [{}]` on js: `c` binds `null` with no error, though `two` has two positional values. Naming more positional slots than the value has should be a compile error where the shape is known (the callee's return), and an error at runtime otherwise, not a silent `null`.

For comparison, the matching arity works and ignores named keys (`a, b = two()` gives 1 and 2), and a mixed destructure works (`a, b, :extra = two()`). Found probing a destructure for `kanban/board.bv`. Not checked on rust or erlang.
