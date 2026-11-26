---
created: 2026-11-01
---
# Subclasses should inherit the parent's state

A subclass inherits methods but not state:

```brevity
Counter = *{
  a *Integer = 0
  @add! = (i Integer) { a <- a + i }
  @get = { return a }
}
Sub = (Counter |) *{}
```

Using Sub fails on js and Rust with Cannot set 'a' — only 'ref' variables and actor references support '<-', and on Erlang in erlc. resolveSuperclassChain in src/subclass.js returns inherited functions, params, setters and ingests, but not other state. __tests__/classes/subclass_runtime.test.js has the failing test.

To decide: whether a subclass gets its own copy of the parent's state and runs the parent's constructor body, and how that fits with ingest and wrapped supertypes.

Done when the test passes on js, Rust and Erlang.
