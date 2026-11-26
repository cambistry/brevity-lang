---
status: inbox
created: 2026-11-24
---
# A private zero-arity function computing from a cell is "not defined"

```brevity
m *Integer = 3
top = -> m + 1
@go = { return top() }
```

fails: `'top' is not defined (line 3)`, with `top` or `top()`, arrow or block body. It compiles when the body returns the cell bare (`-> m`), uses no cell (`-> Text.size("a")`), or takes a param (`(k Integer) -> m + k`), and when the function is public (`@top`). `-> List.size(xs)` on a list cell fails the same way. Possibly the same cause as `a-private-silent-function-that-writes-is-not-defined-at-its-calls`. Found writing `kanban/board.bv` (`Column.@last`).
