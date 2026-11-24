---
status: inbox
created: 2026-11-17
---
# `T::x` from a subclass that has a class block of its own

A subclass with no class block uses its parent's (src/singleton_classes.js: it adopts the parent's `membersClass` and puts that block first in its chain), so `T::prot`, `T.pub` and `class::prot` work from its actors. A subclass with a block of its own can't reach its parent's:

```
T = (s Integer) *{ @r = -> 1 } ++ actor { prot *Integer = 1 }
U = (T ++ u Integer) *{ @r2 = { return T::prot } } ++ actor { other *Integer = 1 }
```

→ "'T::prot' — 'U' has a class block of its own, and reaching a parent's protected members from it isn't supported yet"

U's chain holds U's block, not T's, so nothing reaches T's level. Public `T.pub` still works from U, as a message to `T__class`. T's inherited methods run by a U actor are also affected: their `class::` / `T::` reads are compiled against T's chain, where T's block is level 1, so in U they would hit U's block instead.

This is class-block delegation (notes/class-scope-and-inheritance-2026-11-16.md, "Class blocks inherit by delegation"):

- a cell belongs to the block that declares it, so U without a redeclaration uses T's cell;
- a redeclaration in U's block overrides, late-bound, so T's code run for U uses U's cell;
- functions layer and are late-bound.
Today `class` is resolved statically, from the text (T's code means T). The late-bound reading belongs here.

Done when, on js, rust and erlang (no target skipped)

- From U (with its own block), `T::prot`, `T::protFn()` and `T::prot <- v` reach T's block, and T's actors see the write.
- T's inherited methods run by a U actor read T's cells, unless U's block redeclares them, in which case they read U's.
- `class::x` in T's code run by a U actor follows the running class (late-bound).
- The "isn't supported yet" error and its test in class_qualified.test.js are replaced by runtime tests.
