---
status: inbox
created: 2026-11-24
---
# `over` and `reduce` accept an Integer as the list

Both compile, with no form behind them:

```brevity
@f = (n Integer) {
  r List of Integers = over(n) (i Integer) { i }
  return r
}
@g = (n Integer) {
  r List of Integers = reduce([], n) (acc List of Integers, i Integer) { List.append(acc, i) }
  return r
}
```

A non-list should fail where it's met. (If a range form is wanted, that's a design question for notes/.) Found writing `kanban/board.bv`.
