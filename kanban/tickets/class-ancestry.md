---
status: queued
created: 2026-05-20
---
# Fix: A typed local should not accept an actor of an unrelated class

Problem: a class-typed param checks ancestry (a subclass is accepted, an unrelated class is refused), but a typed local doesn't: `@f = { p P = R(1); return p.a() }` compiles.

The param case:

```brevity
P = (s Integer) *{ @a = -> 1 }
Q = P ^ (t Integer) *{ super(t) }
R = (s Integer) *{ @b = -> 1 }
g = (p P) -> p.a()
@ok = { return g(Q(1)) }    // compiles
@bad = { return g(R(1)) }   // 'g()' positional arg 1: 'R' is not assignable to 'P'
```

Expected: on js, rust and erlang, a typed local (and a typed cell) uses the param's check: `p P = R(1)` is a compile error and `p P = Q(1)` compiles. Tests beside the param case.

**Decided (2026-11-26):** the same check for a typed cell and for every write to one (`<-` and
the like), not only the declaration.
