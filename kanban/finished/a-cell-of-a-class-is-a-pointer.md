---
created: 2026-11-27
---
# Feature: a cell of a class is a pointer, repointed through `*name`

`cref *C = a` declares a pointer to a C. `*cref <- b` repoints it, `cref.go()` calls through it, and
`cref <- v` sends `$set` to the actor. Design: `notes/actor-pointers-2026-11-27.md`.

Today a write to a cell holding an instance (`c *T = T(4); c <- T(6)`) is sent to the instance as
`$set` on js and rust, so it does nothing. erlang raises on it, and rust fails to build some forms.

Expected, on js, erlang and rust:
- `*cref <- b` stores the new address, on a local cell and on a state cell. It takes only a C or a
  subclass.
- `cref <- v` sends `$set` to the actor, and is a compile error unless the class has `set`.
- `cref.go()` calls the actor; `f(cref)` passes it; `f(*cref)` grants the pointer to a `(p *C)`
  param.
- `sub *cref, fn` gets each repointing; `sub cref, …` is a compile error.
- A pointer that may be null is narrowed before a call through it.
- Value cells are unchanged.

**Decided (2026-11-27):** the cell is `*name` and the actor is the bare name, following the
call-site grant (`bump!(*n)`), as a temporary form; `cref <- v` is the actor's `set`, a compile
error when the class has none; value cells are unchanged. This replaces the C dereference the
first draft of the note proposed.
