# Session notes — 2026-04-23 (structured children pivot)

## Pivot: drop string-innerHTML, use structured `children` array

The `inner_html: "..."` wire shape (DOM.X receives a markup string, parses it
internally, splits static subtrees from reactive ones by scanning for `#<…>`)
is being abandoned. The structured-children shape replaces it.

### Why the pivot

The string-innerHTML shape traded a little construction simplicity and fewer
wrapper actors for a pile of serialization complexity:

- `#<…>` tokens had to survive the HTML tokenizer, which wants to treat `<`
  as tag-open. DOM.X grew its own parser (`populateFromInnerHtml`,
  `parseAndBuild`, `findMatchingClose` in browser/runtime.js) to walk the
  string itself rather than trust `element.innerHTML = …`.
- A tag-position variant was on the table (`<#<DOM @p>>content</>`) to give
  DI-resolved nested constructors a wire form. That added: a second meaning
  for `#<…>` (tag constructor vs. value slot), stack-based `</>` close
  matching, and future attribute ambiguity. Every piece small; stacked,
  fragile.
- The shape was browser-only. Rust / Erlang / native targets have no
  `innerHTML` to lean on and would need a structured payload anyway — so the
  string shape was going to fork eventually.

Replacement: `children: [...]` — an ordered array of bare text strings and
address strings (`#<…>`). Matches the XML Information Set's `[children]`
property exactly (ordered mixed-content list of element + character
info-items; attributes are a separate unordered property on the element, not
a child). Generalizes beyond HTML to any XML dialect.

### The new wire shape

`<div><p>content</p></div>` compiles to sequential pre-dispatch:

```
p_addr = await #sendNew({children: ["content"]}, "DOM @p")
div_addr = await #sendNew({children: ["#<" + p_addr + ">"]}, "DOM @div")
```

- **Option (b)** chosen over (a): caller pre-dispatches each nested element,
  collects addresses, passes them as `#<addr>` strings in the parent's
  children. N round-trips for an N-element tree, but every child is
  independently addressable before its parent exists.
- **Text children:** bare strings.
- **Closure children** (`{ expr }` interp): bare `"#<@N>"` strings —
  outbound prepend in `rewriteAddressStrings` gives them the sender's
  address, same as today.
- **Attributes:** sibling property, not this pass.
- **Abbreviated close tag `</>`:** dropped — was an artifact of the
  string-innerHTML tag-address form.

### Address unwrap on return

`#sendNew` resolves to the **unwrapped** address (classes.js:937 strips
`#<…>`). So codegen re-wraps with `'#<' + addr + '>'` when placing a
returned address into the parent's children array.

### Compile-time DI resolution

The DI destructure `<DOM: (:div, :p) *>` defines which element tags the
actor may use. A template referring to an unlisted tag → compile error.
No fallback to literal HTML.

## Static-subtree inlining rule — retired for now

`notes/template-static-subtree-inlining-2026-04-22.md` argued that static
subtrees should NOT earn a CAM handle. That rule was specific to the
string-innerHTML shape (where the "optimization" was just `el.innerHTML = s`
fast-path). With structured children, every element materializes a DOM.X
actor.

Cost: a page with dense static markup creates one actor per element. For
typical apps this is acceptable; for dense DOM-heavy pages it may hurt and
will want revisiting. Noted, not solved.

## Deferred: ref-counting cleanup

Structured children creates a DOM.X actor per element. Without teardown,
actors leak when a tree is removed. The natural mechanism is
reference-counting against structural parents and external holders.

Not building it this week. Two small risks with the defer:

1. Tests that tear down + rebuild a tree may see subscribed reactive
   children still firing `re`s into detached text nodes. Asserts on the
   fresh tree still pass; extra posts are noise.
2. Ref-counting has real design questions of its own (when does a ref
   count — on `new`-return? on `append!`? on forwarding as a bare string?).
   Worth its own pass, not a last-mile addition.

## Landing plan (5 commits)

1. **Recursive DOM lexer/parser.** Stack-based open/close tag matching
   replaces `indexOf('</tag>')` (lexer.js:166, which silently picks the
   wrong close on same-tag nesting). `DomConstructor.children` admits
   nested `DomConstructor` entries. Temporary codegen adapter flattens
   nested constructors back to an HTML string so the inner_html wire path
   stays green.
2. **Structured-children codegen + runtime handler** (one commit, green-
   throughout). Codegen emits pre-dispatch await chain. DOM runtime
   `handleDomNew` branches on `children: [...]` vs. legacy
   `inner_html: "..."`.
3. **Compile-time DI check.** Tag-not-in-list → compile error.
4. **Router strip on hop.** Extend the existing top-level `to`-field
   alias-strip (runtime.js:261) to walk payload strings and strip the
   matching alias from embedded `#<ALIAS …>` tokens when the message hops
   into ALIAS. Mirror of `rewriteAddressStrings` outbound prepend.

Legacy `inner_html` wire path stays for now (no tests driving it after
step 2 lands; can atrophy or be removed later).

## Cross-refs

- `notes/template-static-subtree-inlining-2026-04-22.md` — string-innerHTML
  shape this pivots away from; static-inlining rule retired.
- `notes/layer-a-closure-as-child-2026-04-22.md` — `#<@N>` closure token
  mechanism, still used for closure children.
- `notes/big-factory-example-2026-04-21.md` — factory/app composition
  example; Layer A shape updated by this pivot.
- `notes/dom-as-actor-subsystem-2026-04-13.md` — conceptual frame
  (addresses, not references) unchanged.
- `notes/session-2026-04-23.md` — earlier today: `<<…>>` → `#<…>`
  delimiter change.
