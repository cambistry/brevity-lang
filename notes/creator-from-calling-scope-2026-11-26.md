# Element provenance from `from`, styles matched by the same `from` — 2026-11-26

Direction, from discussion; not implemented. Supersedes `add-trace-on-return-2026-11-14.md`
(`__add_trace__`) and the `<style for={ … }>` / `ctor` key of `ctor-provenance-2026-11-09.md` and
`scoped-styles-2026-11-09.md`. Adopts `from-names-calling-scope-2026-11-14.md` as the mechanism;
its open questions carry over.

## The idea

- **`from` is the provenance.** Every request carries, in `from`, the address of the innermost
  addressable scope whose code made it (the function or class), translated by each parent on the
  way out like `from` today.
- **The receiver keeps it.** An element constructor reads the `from` of the `$new` that made it
  and sets a field (the `creator` attribute, name not final) to it. How a constructor reads its
  request's `from` is open, and may need a language feature (see Open).
- **The style call from the same scope matches it.** An `HTML.style(…)` call made in the same
  scope arrives with the same `from`. HTML adopts a sheet scoped to `[creator="<that from>"]`.
  Nothing names the maker explicitly: being called from the same address is the link.

The style is an ordinary `<style>` element written in the maker, beside what it returns:

```brevity
factory = {
  <style>padding: 1rem; h2 { margin: 0; }</style>   // $new HTML:style, from: main:factory
  <div><h2>Hi</h2></div>                            // $new HTML:div,   from: main:factory
}
```

If adjacent elements on one line parse greedily as a sequence, the braces may be unnecessary:
`factory = () -> <style>…</style><div>…</div>`. Undecided: whether that sequence is
statements-then-value or a fragment. Today it is a parse error.

## What follows

- **They match by construction.** Both messages leave the same scope and cross the same parents,
  so both get the same translated address wherever the app is mounted. The relocation problem
  remains only for hand-written page overrides.
- **No per-return calls, and no "new since the body started" test** on any target. The cost of
  `__add_trace__` (one call per returning level) is gone.
- **Repeated calls should be idempotent.** A style call in a function body runs on every call, so
  HTML keys sheets by `from`: a later call from the same address replaces that sheet's text
  instead of adding one. That also makes a reactive sheet a plain re-send.
- **Forwarding records nothing.** In `@component = -> @template()`, the element is
  `creator="main:template"`; `@component` sent no `$new`, so a style from `@component` doesn't
  match it. The element belongs to the scope that commissioned it (as in `ctor-provenance`).
  `__add_trace__`'s returning-scope chain is not reproduced.
- **Every element a scope builds carries the same `from`,** internal parts included, so HTML can
  stamp them all. Selectors then target the scope's own elements directly, and a nested maker's
  elements carry their own value. Whether bare declarations mean "the root" (the element whose
  parent has a different `creator`) is a selector question for HTML.
- **Closures must take the enclosing named scope** (open in `from-names-calling-scope`). If a
  closure or `{{ }}` hole carried its own `@N`, elements it builds would miss the maker's style.
- **A class's constructor block sends from the class** (`main:C`), so a style call in the block
  and the block's elements match, shared by every instance.
- **Trust is unchanged:** `from` is hop-mutable and unsigned. Advisory, for styling and
  debugging.

## Open

- **How a receiver reads its request's `from`.** HTML is runtime code today, but a service
  written in Brevity needs a way for a constructor (or any handler) to see the requesting
  address. Not a form that exists yet; check the language docs before proposing one.
- **How HTML tells a maker's sheet from an in-page `<style>`.** A `<style>` that is appended
  somewhere (`body.append!(<style>…</style>)`) is a page element. One that is never attached
  would be the maker's sheet. Whether that distinction is sound, or needs a marker, is open.
- **Methods after construction** (`. C make` vs `. C 1 make`), from `from-names-calling-scope`.
  The class form keeps one sheet per class.
- **Replies addressed to a function or class scope,** and `from` becoming reply-only (a request to
  `main:template` would invoke it), from `from-names-calling-scope`.
- **Attribute name** (`creator` favoured), and whether the separator suits `~=` matching.
- **Sheet lifetime:** tied to the actor that holds the scope.

## Speculation: the style as a class relationship

Not decided. The style belongs to the maker's class, built once, and the elements to its
instances:

```brevity
Factory = actor { <style>…</style> } ^ *{ <div>…</div> }
```

The catch: a constructor block returns no value (`constructor-tail-and-ingest-retired-2026-11-26.md`),
so an instance can't *be* the `<div>` it builds. Two existing shapes could close the gap.

**A projection (a wrapper).**

```brevity
F = *{
  self as HTML::div = -> <div>…</div>
} ^ { <style>…</style> }
```

- `f` is an F actor, and the div is a separate HTML actor handed out on conversion. That's
  honest only as "F presents as a div", not "F is a div".
- It reintroduces the unwrap problem `element-extension-2026-11-23.md` rejects: DOM is handed an
  address it doesn't own.
- Each conversion builds a new div unless the result is cached.
- The projection runs after construction, so which scope its `$new` names hits the open
  "methods after construction" question.

**Extending the element (no wrapper; preferred if it holds).** `element-extension` already reads
`<div …>` with names of its own as `HTML::div ^ { … }`, a layer on the DOM node, preferably run in
the HTML host. As a class:

```brevity
F = HTML::div ^ { <style>…</style> } ^ *{ … }
```

- The constructor returns `self`, and `self` is the div. `f` is the element's address.
- The singleton layer holds the style, built once. Instances are divs whose `ty` names `F`.
- The root needs no `from` stamp: its type tag names `F`, so HTML can scope the sheet by type.
  `from` still covers the parts the constructor builds, which arrive as `main:F` (a constructor
  block sends from its class).

Open, for this shape:

- How the constructor fills in the div's children and attributes (`self.append!(…)`, or a
  declarative form).
- Whether a singleton layer can sit over a remote parent like `HTML::div`.
  `caret-composition-2026-11-19.md` shows parents first, then layers, but not this case.
- Where the layer runs. Only in the HTML host is the element itself the receiver; by delegation
  (`remote-superclass-2026-11-16.md`) the layer is an actor beside the node, which is a wrapper
  again.
