---
status: investigation
created: 2026-11-26
---
# Investigate: addressing a type declared in an instance

```brevity
W = *{
  type X (Integer)
  @make = -> X(1)
}
```

A type declared in an instance body is tagged through its class today, `:~W:X`
(notes/type-keyword-and-actor-scoped-types-2026-11-13.md), as if the class block declared it. A
class declared in an instance body lives under the instance (`#<:Outer:1:~Inner:1>`,
notes/class-of-and-self-return-2026-11-23.md), because it captures the instance's scope. A type
captures nothing, so the class tag may be right, but it is an instance's declaration addressed
as the class's.

We should support the form; it needs its own addressing approach. Settle whether a type an
instance declares is the class's (one type, `:~W:X`) or the instance's, and what reads a type's
declaration site to decide.
