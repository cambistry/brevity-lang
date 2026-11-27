---
created: 2026-11-26
---
# A pure value mid-body is dropped silently

A value written as a statement before a body's last line compiles and is discarded:

```brevity
k Integer = 1
@g = {
  1 + 2
  "x"
  k
  4
}
```

Each becomes an `ImplicitReturn` that no target emits. A call or an element mid-body is a statement run for its effect (src/parser.js, the mid-body pass), but a pure value has no effect, so it can only be a mistake (a value meant as the reply, a forgotten bind).

Question: should a pure value mid-body be a compile error ("a value here does nothing: bind it or return it")? Compare the existing rule that a `!` body's tail value is an error (src/writer_body.js).
