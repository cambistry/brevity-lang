---
created: 2026-11-17
---
# A class as a value: `k = C`, `k = class`

A class can be built (`C(args)`, `class(args)`) and its members reached (`C.x`, `C::x`), but a class can't be used as a value. `k = C` fails to compile:

```
@N = actor {
  new = (seed Integer) *{
    @named = {
      k = @N
      return k
    }
  }
}

→ "Variable 'k' requires a type annotation — use 'k Type = ...'"
```

`k = class` fails the same way: src/singleton_classes.js (resolveClassOf) lowers it to exactly `k = C`, so it will work once `k = C` does.

To decide

- The wire form of a class value: presumably the class's address (`#<:N>`) with `ty` naming it, as an actor reference does.
- Its type, for an annotation (`k Class = C`? `k C = …` already means an instance of C).
- What you can do with one: build (`k(args)`), reach its public members (`k.count`), pass and return it. Whether `k::x` is allowed (probably not: `::` is static and family-only).

Done when, on js, rust and erlang (no target skipped)

- `k = C`, `k = @C` and `k = class` bind the class; `return k` replies with it; `k(args)` builds one; `k.pub` reads a public class-block member.
- Tests in __tests__/classes/class_qualified.test.js (or a new file beside it) cover each form.
- notes/class-scope-and-inheritance-2026-11-16.md drops "(a class as a value isn't supported yet)".
-
