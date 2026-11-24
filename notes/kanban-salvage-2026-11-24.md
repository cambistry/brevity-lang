# Ideas salvaged from the old kanban

**Date:** 2026-11-24
**Status:** open questions only. The old board (March to May 2026) used syntax that has since changed (`$state`, `actor … end`, `|args|`, `ref`). These are the ideas that still stand apart from syntax and aren't recorded elsewhere. The `catch` spec moved to `catch-2026-03-30.md`.

## Construction order
Self-sends make *reference* order irrelevant (see `self-send-vs-direct-call-2026-05-09.md`). Open: *invoking* a function during construction before its target has been defined. The old proposal made that a compile error (membership rule for references; sequential rule for invocation). Public handlers satisfy it structurally, since no one can call them until construction ends.

## Clone
Any actor can be cloned as a deep, recursive copy of itself and its hosted children. A clone repopulates the copy's scope from the source; it does not re-run the constructor, because what re-initialisation means for each child is unanswerable. Open: closures held for child constructors.

## Capture and restore
Stateful actors answer a CAM capture message by recursively serialising their state, so processes survive spin-down, restart and reallocation. This is host-kernel lifecycle, not a language construct. Only mutable state (fields, children) needs capturing; plain bindings are immutable and derived during a dispatch. A corollary: the JS target should emit `const` only, renaming on rebind as Erlang does (`X`, `X__1`).

## Declared serialisation
A type may supply its own wire encode and decode.

## Read-only vs effectful calls
A distinction enforced by the language between calls that only read and calls with effects. A related idea was a call form that runs an effect and returns the receiver, for chaining.

## Trust and inference
`trust <authority>` for a predicate (`Signed`, …): the authority declares and resolves the predicate, and the actor accepts its verdict. Generalises to delegated inference, such as producing a signature.

## Plural type names
`Apple(s)` declares the plural alongside the type, so `List of Apples` reads naturally. Constructors only.

## `catch` §9 label references
Passing `&#label` to a callee so it can exit the caller's catch. Not implemented (see `__tests__/keywords/catch.test.js`). Check its `#` sigil against current private-name syntax before building.
