---
created: 2026-11-19
---
# Declared actors are tagged `*`; an actor is a value

Design: notes/actors-not-classes-2026-11-18.md

Depends on: address replies are array-wrapped

Summary

There are no classes, only actors. "Class" is used only for membership through `$new`: the actors `Box`'s `new` built are of class `Box`. `ty` carries what the value doesn't already say:

- An actor a `new` built is tagged with its maker's address, as now: `{ re: ['#<:Box:1>'], ty: [':Box'] }`, `ty: ['svc.bv:Counter']`.
- An actor no `new` built (a declared actor: `Box` itself, a singleton, the file actor) is tagged `*`, the Opre universal for "an actor": `{ re: ['#<:Box>'], ty: ['*'] }`. Its interface is at its address, and the service document describes it there.

`Class` is retired as a type and as a tag; nothing named `Class` survives. Where Brevity needs a name for "any actor", it's `Actor`, which is `*` on the wire.

Semantics

- Any declared actor is a value: `k = Box`, `k = s`, `return Self`, `[Box, s]`, `{k: Box}`, `k == Box`. Each one is its address, typed `Actor`, tagged `*`.
- `k(args)` is `$new` to the actor `k` holds, however `k` was bound (statically, as a param, from a return, in a cell). `k.x` is a message to it. A static binding may still be resolved at compile time.
- `::` stays static: `k::x` resolves when `k` is statically bound to a declared actor (family-checked against it). On an actor that arrives at runtime, it's an error.
- Annotations:
- `k Actor` takes any actor, built or declared.
- `k (seed Integer) -> *{ … }` (a constructor profile) types an actor that has a `new`.
- An interface (`*{ … }`) types any actor with those members.
- `k Box` takes only actors `Box` built, so `Box` itself (`*`) isn't one.
- A declared actor named from code that can't name it relatively (an instance naming its file's `Box`) uses its absolute address (`#<c.bv:Box>`). That needs the file's name, as `Self` does.

Errors

- `k Class = …`: "'Class' is retired — use 'Actor' for any actor, or a constructor profile 'k (…) -> *{ … }' for one with a `new`".
- `k::x` on an actor not statically bound: "'::' needs the actor written where it's used; 'k' is only known at runtime".
- `k(args)` on an `Actor`-typed or interface-typed reference with no constructor profile: compiles (it's a message), and is unhandled at runtime if the actor has no `new`.

Work

- Replace the `ClassValue` lowering (the slot list in src/class_values.js) with expression-level actor values: inference types a declared actor's name as `Actor`, and each target's expression codegen emits its address.
- `k(args)` on a runtime reference: send `$new` to its address and await the reply (js, rust, erlang).
- `Actor` as a type: annotation, inference, and the `*` tag on the way out; on the way in, a typed param checks it.
- Tags: `*` for declared actors and `Self` (replacing `Class`, and today a singleton's own address). Built actors are unchanged.
- Fix the singleton value (`return s` replies `re: [{}]` today).
- Remove `Class` everywhere (inference, codegen tags, js/rust/erlang runtime checks, the docs) and add the retired-name error.
- Docs: "class" only for membership through `$new`; everything else says actor (an actor with a `new`, the actor's block, singleton and file as actors). Rework USAGE, LANGUAGE_OVERVIEW, LANGUAGE_FEATURES, README, docs/SYNTAX_CRIB, docs/VALUES_AND_ACTORS, docs/CAM and docs/LLM_WRITING_BREVITY. Add pointer lines atop class-scope-and-inheritance-2026-11-16 and vocabulary-refactor-2026-05-15.

Tests

- Each declared kind as a value (an actor with a `new`, a singleton, the file via `Self`) returned, passed, in a list and in an object, and compared: address and `ty: ['*']`.
- `k(args)` and `k.pub` with `k` bound statically, as a param, from a return, and in a cell.
- `k Actor` takes a declared actor and a built one.
- `k::x` statically bound (works, family-checked) and on a param (error).
- A param `x Box` refuses `Box` itself (`*`) and takes one it built.
- `k Class` gives the retired-name error.
- An instance naming its file's declared actor: absolute address.
- js, rust and erlang; no target skipped.

Out of scope

- Protected actors going out (the protected-classes follow-up, now covering any protected actor).
- Whether a document advertises an actor's `new`.
