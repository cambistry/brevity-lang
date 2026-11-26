---
status: inbox
created: 2026-11-24
---
# Fix: a call on an actor-typed cell leaks an internal name

Problem: this fails with `Variable 'asraw1_r' requires a type annotation`, naming a generated variable:

```brevity
View = *{ @title = -> "v" }
view *View = View()
@t = -> view.title
```

Binding first works: `v View = view; return v.title`. Found writing `kanban/board.bv`.
