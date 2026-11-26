---
status: inbox
created: 2026-11-24
---
# A private silent function that writes is "not defined" at its calls

```brevity
n *Integer = 0
bump. = { n <- n + 1 }
@go. = { bump... }
```

fails: `'bump' is not defined (line 3)`. Declaration order doesn't matter, and `bump()...` fails the same way. With an empty body (`bump. = {}`, as in `functions/silent.test.js`) it compiles, and so does a public `@bump.` called as `@bump...`, or a `bump.` local to the calling function. Found writing `kanban/board.bv`.
