# Constructor star leads: `*(params) { … }` — 2026-11-25

Decided, not implemented. Revisits the placement in
`session-2026-10-28-delimited-class-star-body.md` (`(params) *{ body }`), which recorded the
grammar but no reason for it. Builds on `actor-literal-2026-11-17.md`,
`caret-composition-2026-11-19.md` and `actors-not-classes-2026-11-18.md`.

## Decision

The `*` leads the definition, before the params:

```brevity
C = *(seed Integer) { … }      // a constructor with params
C = *(seed Integer) -> { … }   // optional arrow
C = *{ … }                     // no params
D = T ^ *(n Integer) { … }     // a constructor layer over a parent
```

`*(params) { body }` is sugar for a constructor spelled out: a function that builds and returns a
new actor on each call.

```brevity
C = (seed Integer) -> actor { … }
```

Both forms are legal and mean the same thing.

## A constructor names a class where it lands

`(p) -> actor { … }` is a constructor. What makes it a class is where it is bound:

- **Assigned to a name:** `C = (p) -> actor { … }` names the class `C`.
- **As an actor's `new`:** `new = (p) -> actor { … }` attaches it to that actor, which becomes
  the class of the actors it builds.
- **As a layer:** `C = actor { <singleton> } ^ (p) -> actor { <instance> }` composes a singleton
  and a constructor, as `actor { … } ^ *(p) { … }` does.

So the spelled-out form types and documents exactly like the sugar: a constructor profile, the
family checks (`C::x`, `k C` taking only actors `C` built), and the same service document.

## Type notation

The constructor profile becomes `*(…) -> { … }`:

```brevity
k *(seed Integer) -> { get () -> (Integer) }
```

`(…) -> *{ … }` reads as a function that returns a constructor, which it isn't. The star leads in
the type as in the source.

## Lineal header

Unchanged: `*`, params one per line, `*`. The lead star makes it fit better, since the lineal
header already opens with the star before the params.

A later concept, `lineal-definitions-2026-11-25.md`, would replace this header with `*(` and
params one per line, closed by `)`, and a lineal body to `end#Name`.

## Why

- **The lede comes first.** `val *Integer = 0` says "a cell" before anything else. In
  `C = (params) *{ … }` the star arrives after the params, so the line reads as a function until
  the last token before the body. `C = *(params) {` says "a constructor" at once.
- **It matches the other stars.** Cells (`*Integer`), remote instances (`*Git(dir: …)`) and the
  lineal header all put the star in front.
- **It still separates the `^` layers.** In a chain, `{ … }` is a singleton layer and a
  constructor layer is starred. `T ^ *(n) { … }` against `T ^ { … }` keeps that, with the star
  where the eye starts.
- **The desugaring is the semantics.** Under `actors-not-classes`, a class is an actor with a
  `new`, and `new` is a function whose result is a fresh actor. `(p) -> actor { … }` says exactly
  that, so the sugar explains itself.
- **No syntax hazard.** After `=`, `^` or `<<` a `*` can't be multiplication, so `*(` is
  unambiguous. `*(params) { … }` parsed to the same AST as today's form before 2026-10-28.

## What the spelled-out form needs

Today both `(p) -> actor { … }` and `(p) { actor { … } }` are parse errors: `actor` is a keyword
only where a definition starts, and an unnamed `actor { }` in a body is refused. The language
needs:

1. **An actor literal as a value:** after `->`, and as a body's returned value.
2. **A literal closes over the call:** the actor built reads the function's params, as an
   instance reads its constructor params today. This is the other side of "no params on an inline
   singleton; it closes over its enclosing actors" (`classes-as-singletons-2026-11-09.md`): here
   the enclosing scope is the call itself.
3. **Each evaluation builds a new actor.** A literal in a function body is evaluated per call,
   unlike a singleton, which is built once with its enclosing actor.

## Open questions

- **The file header.** `( deps ) [->] *{ body }` and `( entries ) [->] actor { body }` take
  dependencies, not constructor params. Does it become `*( deps ) { … }`, or keep its own form?
- **A body that returns a literal on some paths.** Is `(p) { if … { return actor { … } } … }` a
  constructor, or only a function whose every return is an actor literal?
- **Overload clauses.** `@C = …` and `C << …` presumably follow.
