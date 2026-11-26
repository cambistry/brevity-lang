---
status: inbox
created: 2026-11-24
---
# An unannotated bind should infer more than literals and own calls

Today: `x = …` without a type compiles for a literal, a list literal, a lambda, a call to an own function or actor method, or a doc entry (`Files.read(path: p)`). Everything else fails with `Variable 'x' requires a type annotation`:

```brevity
n = Text.size("ab")
n = List.size([1])
n = 1 + 2
n = if ok 1 else 2
n = "x#{1}"
```

Want: core methods have known return types, and arithmetic, conditionals and interpolation have result types the checker already computes, so these should bind like `n Integer = …` (the done `infer-an-unannotated-binding-s-type-from-the-callee-s-return` and `notes/session-2026-11-06-bind-takes-callee-type.md` cover calls only). `kanban/board.bv` keeps about 25 annotations only for this.
