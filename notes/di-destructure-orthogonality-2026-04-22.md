# DI / destructure orthogonality (2026-04-22)

Sidebar thinking, not a plan. Pinned here so the shape is findable when
the Layer A template refactor comes around (the one that fixes
`<tag>...</tag>` to resolve `tag` via normal scope lookup instead of
hardcoding `DOM @tag` in the lexer).

## The reframe

Current form `<DOM: (:div) *>` conflates two concerns:

1. **DI** — "the actor has access to a dep called DOM."
2. **Destructure** — "bind `div` locally as DOM's `div` method."

Splitting them yields:

```
<:DOM *> {
  (:div) = DOM            // or some variant below
  @create = -> <div>...</div>
}
```

DI becomes minimal (`<:DOM *>` = "DOM is available as a ref in this
scope"). Destructure is a general binding operation anyone can use,
anywhere a binding makes sense. The existing `<DOM: (:div) *>` form
stays valid as sugar for DI-plus-destructure.

## Why it's worth doing

- **Destructure is general.** `(:div) = DOM` reads exactly like
  destructuring any other structure. Uniform with however replies and
  function returns are destructured.
- **Scope is explicit.** File-level destructure → actor-wide; handler-
  level destructure → just that handler. Under `(:div)` in DI, the
  scope is always actor-wide whether you wanted that or not.
- **`div` is a regular name.** Passable to helpers, storable, first-
  class — not a lexer-special-cased tag.
- **Makes `(...)` spread earn its keep.** Template-heavy actors can't
  avoid it: `<div>...</div>` needs `div` in scope. `(:div)` for
  explicit, `(...)` when the whole surface is wanted.

## Syntax vocabulary

```
(div) = DOM                 // bind div locally
(div: dv) = DOM             // bind dv locally (aliased from div)
(...) = DOM                 // spread all of DOM's surface into scope
(div: dv, ...) = DOM        // alias div as dv; spread the rest (sans div)
```

Pattern mirrors JS-style rest-destructuring — named fields with optional
aliases, `...` filling in whatever wasn't explicitly listed. `(:div)`
is the sigil-positional form from existing structure-destructure
convention; likely redundant with `(div)` for this purpose, but fits if
we want grammar consistency.

## Scope rules

- **Handler-level destructure** — just that handler's scope. Per normal
  shadowing, can re-bind in sibling handlers with different semantics
  (`(...) = DOM` in one, `(...) = OtherService` in another).
- **File-level destructure** — actor-wide binding, like any top-level
  decl.
- **DI availability precedes destructure.** Can't destructure from a
  dep that isn't imported into the actor.

## Connection to the `<tag>` resolution fix

Current: the lexer emits `DOM_CONSTRUCTOR { tag: 'div' }` and codegen
hardcodes `DOM @div` as the routing address, regardless of scope. This
is magic in the wrong direction — `<div>` works even when `div` isn't
in scope.

Correct: `<div>...</div>` desugars to a function call on the identifier
`div`, args = `{children: [...]}`. Scope lookup resolves `div`
(destructured from DOM, spread from DOM, or locally defined). If
unresolved, compile error.

This makes the destructure load-bearing for templates:

- No destructure, no template. `<div>` doesn't compile without `div` in
  scope.
- The DI/destructure split means the error message can point at the
  right thing: "you haven't destructured `div` from DOM, or spread its
  surface."
- `<tag>` unifies with `<Name attr=.../>` — both are function calls,
  differing only by content-bearing vs. attribute-only shape.

## Open questions (no strong opinions yet)

- **Aliasing syntax** — `(div: dv)` reads well; alternative `(div as
  dv)` also plausible if "as" is the general re-naming keyword.
  Settled on `(div: dv)` for now.
- **Rebinding / shadowing** across handlers — probably just usual
  scoping rules.
- **Interface visibility at compile time** — only makes sense for deps
  whose interface is known to the compiler. `#` generic-constructor
  deps (signature deferred to host) can't be destructured since the
  surface is unknown. Should produce a clear compile error, not silent
  pass.

## Cross-refs

- `notes/big-factory-example-2026-04-21.md` — factory example uses the
  conflated form today; would update to two-step post-refactor.
- `notes/layer-a-closure-as-child-2026-04-22.md` — Phase 2 bakes in
  `DOM @tag`; the `<tag>`-resolves-via-scope refactor is pending.
- `__tests__/browser/closure_child.browser.test.js` — tests use
  `<DOM: (:div) *>` form today; would migrate when refactor lands.
