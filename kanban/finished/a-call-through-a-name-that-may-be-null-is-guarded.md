---
created: 2026-11-27
---
# Fix: a call through a name that may be null should need a guard

A pointer that may be null (`c *T | null`, `@peer *class | null`) refuses a call through it outside
`if (c) { … }` (`notes/actor-pointers-2026-11-27.md`, `lowerPointerWrites` in `src/validate.js`).
Every other name typed with a union that includes null compiles the call unguarded:

```brevity
T = *(x Integer) { @a = () -> x }
W = *{
  @f = {
    t T | null = T(1)
    x Integer = t.a()     // compiles; fails at run time when t is null
    return x
  }
}
```

The same goes for a param (`(t T | null)`) and for a reply bound with that type.

Expected: on js, erlang and rust, a call or a member read through a name whose type includes null
is a compile error unless a guard has narrowed it, with the error pointers give:
`'t' may be null, so a call through it is guarded: 'if (t) { … }'`. Move the pointer rule to the
general one rather than keeping two.

Open: which guards narrow. Pointers take only `if (t) { … }`. Others to consider: an early exit
(`if (not t) { return … }`, then the rest of the body), `t != null`, `t?`, and `t ?? d` as a value.

**Decided (2026-11-27):** all four guards narrow a name whose type includes null, so a call through
it compiles: inside `if (t) { … }`; after an early exit, `if (not t) { return … }`, for the rest of
the body; `t != null`, in either form; and `t ?? d` as a value. The early exit's negation is written
`not t`, and `!t` too once prefix `!` negates (`prefix-bang-negates`).
