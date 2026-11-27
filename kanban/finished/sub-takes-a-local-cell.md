---
created: 2026-11-27
---
# Fix: `sub` on a cell the function declares should say why it's refused

`sub` takes a cell of the actor it's in (`sub @n, …`, `sub #n, …`), a cell-handle param, or a
child's or dependency's field. On a cell declared in the function body, each target's code
generator refuses it with a list of what it accepts:

```brevity
@f = {
  n *Integer = 0
  seen *Integer = 0
  sub n, (v Integer) { seen <- v }
  n <- 5
  return seen
}
// subscribe: target must be self (@name / #name), a cell-handle param, or <remoteOrChild>.<field>
```

**Decided (2026-11-27):** a subscription in the same scope makes no sense: every write to such a
cell happens within the function's own turn, where it can be acted on directly. So it stays a
compile error, raised by the front end, that names the infraction rather than listing the accepted
targets. The same goes for a pointer (`sub *p, …`) and for a lambda in the function subscribing to
one of its cells.
