---
created: 2026-11-27
---
# Design: review the temporary actor-pointer form

The pointer form in `notes/actor-pointers-2026-11-27.md` was decided as temporary. Review it once
it has been used for a while.

The decisions to revisit:
- **The cell is `*name`, and the actor is the bare name.** This follows the call-site grant
  (`bump!(*n)`). The C dereference first proposed (`*cref.go()` calls, `cref.go()` an error) was set
  aside because `*name` already means the cell. Could the grant take a spelling of its own, so that
  pointers can use the C form?
- **Repointing needs `*`, and a value cell's write doesn't** (`*cref <- b` vs `n <- 1`, `sub *cref`
  vs `sub n`). Should all cells follow one rule?
- **`cref <- v` is the actor's `set`,** a compile error when the class has none. Is a send hidden
  behind `<-` the right spelling, or should it be `cref.set(v)`?
- **`Ref[C]` was rejected.** Does a value type for an address still have a place, in type fields
  and lists, beside the pointer cell?
