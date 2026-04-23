# Template static-subtree inlining (2026-04-22)

Scope: **browser target only.** A rule for which DOM elements in a template earn a CAM handle, and the wire shape the template emits to the outer element's constructor. Follow-on to the Layer A `<<@N>>` closure-address shape in `layer-a-closure-as-child-2026-04-22.md`.

## Problem

Today, every tag in a template gets a synthesized DOM address, even when nothing ever references it:

```
<div class="abc"><p class="subject">Geometry</p></div>
```

The `<p>` is assigned e.g. `DOM/23`, but no one — template, closure, later expression — ever uses it. Dead weight in the DOM index, garbage to collect after the fact. We want the template to avoid creating the unneeded handle in the first place.

## The rule

**A DOM element earns a handle (becomes a DOM.X actor) iff it lies on a path from the template root to a reactive leaf**, or is otherwise externally addressable (named binding, captured reference).

Reactive leaves: elements whose body contains `{ expr }`, an `@ref`, or a dynamic attribute. Propagate "has-reactive-descendant" upward; every element on that path becomes its own DOM.X actor. Everything off any such path is static and gets handed natively to the browser by its structural parent, with no CAM handle.

The root always earns a handle (it's the template's return value).

## What the template emits

The template compiles to a call to the outermost element's DOM constructor, with a single `innerHTML` attribute: the literal inner markup of that element, with inline closures substituted as `<<@N>>` address tokens.

Example:
```
Template = <> {
  @content *Text = "initial"
  -> <div><h1>Title</h1><p>{ @content }</p></div>
}
```
→ at the call site, `Template()` dispatches:
```
{ op: [{innerHTML: "<h1>Title</h1><p><<@0>></p>"}, "new"], to: "DOM @div" }
```

On hop, the router's embedded-substring scanner rewrites local-form addresses inside the string:
```
innerHTML: "<h1>Title</h1><p><<app.bv @0>></p>"
```
(This generalizes Phase 3 of the Layer A note: the scanner matches `<<…>>` anywhere in string fields, not only whole-string payload values. Reserves `<<…>>` as wire-level syntax in strings; escape convention deferred.)

## What the DOM.X constructor does

`DOM.div` (and every DOM.X constructor) on receiving `new`:

1. Creates a real `<div>` element via the DOM subsystem.
2. Parses its `innerHTML` string.
3. Walks the parse result:
   - **Static subtree** (no `<<…>>` anywhere inside): hand the markup to the native DOM, append the resulting element. No CAM actor synthesized for it.
   - **Reactive subtree** (contains `<<…>>`): invoke the appropriate DOM.Y constructor with its *own* `innerHTML` — the inner contents of that subtree, wrapping tag stripped. The recursive call returns an address; the element is appended to the `<div>`.

4. Returns the DOM.div actor's address to the caller.

For the example above, DOM.div processes `<h1>Title</h1>` natively (no handle), and for `<p><<app.bv @0>></p>` dispatches:
```
{ op: [{innerHTML: "<<app.bv @0>>"}, "new"], to: "DOM @p" }
```

DOM.p creates a real `<p>` element, subscribes to `<<app.bv @0>>`, and routes each `re` to its `<p>`'s text content.

DOM.div is **not** a real `<div>` — it's a reactive wrapper actor held by the DOM subsystem, which holds a reference to the actual DOM element and exposes its ordinary API. Same for DOM.p.

### Runtime caveat: DOM.X parses the inner_html itself, not via `.innerHTML`

The naive path — `realDiv.innerHTML = inner_html_string` — does not work when the string contains `<<…>>` tokens. HTML's tokenizer treats `<<` as literal text `<` followed by a new tag-open, so `<<pub @0>>` gets mangled into text `<` + element `<pub>` + text `>`. Tokens do not survive the browser's HTML parser.

The principled response: **DOM.X is not a `<div>`** — it's a reactive wrapper actor. Its job is to resolve `<<…>>` tokens; delegating parsing to `.innerHTML` gives up that responsibility to a parser that doesn't understand our wire format.

Implementation: `populateFromInnerHtml` walks the string itself (small state machine — tags, text, `<<…>>` tokens) and builds the DOM via `createElement` / `createTextNode` / `appendChild`. When a reactive subtree is encountered (nested element whose inner content contains `<<`), construct a cousin DOM.X actor via recursive dispatch. When a pure-static subtree is encountered, `createElement` + `.innerHTML` on the subtree's inner markup (safe — no tokens). When a `<<…>>` is encountered, create an empty text node + subscribe. Pure-static whole inner_html takes the fast path (`.innerHTML` directly, no walk).

One representation (`<<…>>`) throughout — wire, string, runtime. No escape layer.

## CAM tree shape

Recursively synthesized DOM.X actors are cousins under the DOM subsystem, **not** children of their structural parent DOM.X in the actor tree. The example produces two peers under DOM: `@div` and `@p`. The structural nesting lives in the native DOM, which the subsystem arbitrates.

## Ownership and GC

The template caller receives only the root DOM.X's address. Intermediate (reactive-path) DOM.X actors exist because the DOM subsystem holds them to service their subscriptions — not because the template caller holds them. When the root element is removed from the DOM, the subsystem tears down its reactive descendants. (Mechanism: out of scope this pass.)

Static elements have no index-table entries to clean up — they were never put there.

## Why the wire shape is browser-specific

The `innerHTML`-as-single-string shape leans on the browser's native HTML parser for static subtrees — cheap, standard. Runtime parse-and-dispatch inside DOM.X uses the same parser to classify subtrees.

Rust / Erlang / native targets have no `innerHTML` equivalent and will need a structured payload shape. The rule (handle iff path-to-reactive-leaf or externally addressable) still holds; the wire shape will differ. Separate note when those targets grow templates.

## Parser / codegen implications

- Template parser recognizes `{ expr }` inside element bodies (Layer A Phase 2).
- Template codegen for the outer element: emit a `DOM.X new` call with the inner markup serialized to a string, closure sites replaced by their `<<@N>>` wire tokens inline. No structural split at compile time; DOM.X does the split at runtime.
- The compiler does not pre-classify elements as static vs. reactive — that happens inside the DOM.X constructor at runtime, by scanning each parsed subtree for `<<…>>`.
- Phase 3 router scanner: generalize to scan `<<…>>` substrings inside any string field in the payload, not only whole-string values. This is the one prerequisite change outside template-specific code.

## Deferred (next pass)

1. **Reactive attributes.** `<div class={ @theme }>` — closure substitution into an attribute value. Same token mechanism (`class="<<@0>>"`), but DOM.X needs a second subscription path for attributes. Orthogonal to the inner-HTML flow.
2. **Mixed text + closure in a single element's innerHTML.** `<p>Hello { @name }!</p>` — DOM.p receives `innerHTML: "Hello <<@0>>!"`. Not a leaf-of-pure-closure case; requires slot-reconstruction or re-rendering on each update. Held for a later pass.
3. **Component embedding.** `<MyComponent />` inside a template — the component's root is a boundary the outer template sees as an address. Rule still holds.
4. **Subscription / element teardown.** How the DOM subsystem tears down reactive descendants when the root is removed. Out of scope; existing lifecycle note (`reactive-dom-lifecycle-2026-04-13.md`) may or may not cover this shape.
5. **Escape convention for literal `<<…>>` in user-supplied strings.** Deferred with the Layer A escape question.

## Cross-refs

- `notes/layer-a-closure-as-child-2026-04-22.md` — `<<@N>>` wire shape, Phase 3 routing
- `notes/dom-as-actor-subsystem-2026-04-13.md` — DOM as addressable subsystem
- `notes/reactive-dom-lifecycle-2026-04-13.md` — JS-target DOM actor internals
- `notes/big-factory-example-2026-04-21.md` — multi-layer factory / template plan
