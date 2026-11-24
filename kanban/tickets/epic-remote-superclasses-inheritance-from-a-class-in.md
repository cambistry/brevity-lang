---
status: done
created: 2026-11-17
---
# Epic - remote superclasses: inheritance from a class in another file or service

Design: notes/remote-superclass-2026-11-16.md (open; discuss before implementing).

Goal

A class may extend a parent declared in another file, possibly on another node or behind a trust boundary, and inheritance behaves the same as with a local parent, except for timing and the parent's availability:

// Svc.bv

```
T = **{
  total *Integer = 0
  timeout = 30
  @connect = { … uses timeout … }
}
```

// main.bv

**

"Svc.bv": :T

**

```
U = T ++ **{ @fix_total = { total <- total + 1 } }
V = T ++ **{ timeout = 5 }          // T's @connect, run for V, sees 5
```

Applies to both class blocks (singletons) and instances: both are actors built by a constructor, and extending either means composing with a parent-layer actor.

By visibility

- Public: a message, as today.
- Private: never reachable from a subclass, as today.
- Protected (bare): the subclass reads, writes and overrides them, and the parent's own code sees the overrides (late binding). Across actors this has no mechanism yet.

Problems to solve

- Authority: the parent may predate the child and know nothing about it, yet must allow it protected access. The note sketches a grant model (a protected facet handed to whoever extends the parent) in place of any identity check.
- Open recursion: the parent's code, running at the parent, must resolve overridden names against the child. One parent can serve many children at once, so "self" can't be stored in the parent.
- Interfaces: service documents list only public members; an extender needs the parent's protected names and types to compile against.

Open questions (decide before implementing; see the note)

- Whether the parent layer is an actor even within one process (class blocks are already cross-actor locally under the delegated-cell rule), and so whether this protocol should be the local semantics too.
- The Opre representation of "run this as X", and whether it is a real message field locally.
- The extension handshake: what each side gives the other, and whether the override set is fixed when the child extends the parent.
- Extension policy (extensible or sealed by default; who may extend), forwarding and revocation of grants.
- Lifetime of an instance's parent layer; behavior when the parent is unreachable.
- Grandparents and multiple parents across boundaries.
- Whether a trusted parent's code may ever be merged locally instead of delegated.

Done when

- The open questions are decided and recorded in notes/.
- Behavioral tests, phrased as wire-visible outcomes, pass on js, rust and erlang for a local parent and a parent in another [file: protecte](file: protect "")d read/write, a protected function override and a cell redeclaration seen by the parent's code, super-calls, and a sealed or out-of-policy parent refusing extension. No target skipped.

Depends on: the merged, late-bound inheritance and delegated class-block decisions of 2026-11-16 being written up and implemented locally.
