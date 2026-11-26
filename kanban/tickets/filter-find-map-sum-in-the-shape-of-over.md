---
created: 2026-11-25
---
# `filter`, `find`, `map`, `sum` in the shape of `over`

```brevity
names = filter(Files.list(:dir)) (name) { Text.ends_with(name, ".md") }
t = find(all) (t) { t.slug == slug }
slugs = map(mine) (t) { t.slug }
total = sum(heights)
```

Writing `kanban/board.bv`, most `reduce`s existed only to do these.

Want:

- Same shape as `over` and `reduce`: the collection first, then the function. They work on values and cells alike.
- `map` is `over` whose result must be used: a `map` whose value is discarded is a compile error, and `over` is the form for effects.
- `find` returns the first match or `null`. `sum` takes a list of numbers and no function.
- Decide whether they are words like `over`, or `List.` functions (`List.filter(xs) (x) { … }`), like `List.sort` and `List.concat` (ticket `list-concat-and-list-sort`).
