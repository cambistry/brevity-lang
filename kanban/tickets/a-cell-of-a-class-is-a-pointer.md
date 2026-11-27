---
created: 2026-11-27
---
# Feature: a cell of a class is a pointer, dereferenced with a prefix `*`

`cref *C = a` declares a pointer to a C. `cref <- b` repoints it, `*cref.go` calls through it, and
`cref.go` is a compile error. Design and open points: `notes/actor-pointers-2026-11-27.md`.

Today a write to a cell holding an instance (`c *T = T(4); c <- T(6)`) is sent to the instance as
`$set` on js and rust, so it does nothing. erlang raises on it, and rust fails to build some forms.

Expected, on js, erlang and rust:
- A prefix `*` dereferences a pointer: a call (`*cref.go()`), a field read, `*cref <- v`
  (`$set` to the actor) and `*cref.x.subscribe`.
- `cref <- v` repoints. On a local and on a state cell, it stores the address.
- `.` on a pointer is a compile error.
- `b = *Box(0)` is a pointer to a new Box.
- Tests moved to the form: `self/peer`, `syntax/type_names`, `classes/outer_reads`, `cam_test/set`.

Settle proposals 1–4 in the note (precedence, bare pointer as a value, value cells implicit, null)
with the user before the code.
