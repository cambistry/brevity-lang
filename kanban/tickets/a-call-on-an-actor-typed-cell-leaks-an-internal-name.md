---
status: inbox
created: 2026-11-24
---
# A call on an actor-typed cell leaks an internal name

```brevity
View = *{ @title = -> "v" }
view *View = View()
@t = -> view.title
```

fails: `Variable 'asraw1_r' requires a type annotation`, naming a generated variable. Binding first works: `v View = view; return v.title`. Found writing `kanban/board.bv`.
