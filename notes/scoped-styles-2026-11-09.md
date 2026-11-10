# Scoped styles: `<style>`, reactivity, interpolation — 2026-11-09

Design discussion (2026-11-07 → 11-09), not implemented. How CSS attaches to the classes and
functions that make DOM elements, instead of being managed in a global `style.css`. Companion
notes:

- `ctor-provenance-2026-11-09.md`: how an element records which member made it.
- `classes-as-singletons-2026-11-09.md`: `**{ }` singletons, `new`, and `**` file headers.

## Principles

- **Markup is native, so `<style>` is just another element.** It needs no special mode, just as
  templates don't.
- **Natural CSS should be normal and easy.** CSS should read as CSS: real braces, real selectors.
- **Scoping is the capability boundary for styling.** An unscoped `<style>` is CSS's version of
  `eval`: any file that can inject global CSS can restyle, hide or overlay the whole page. Scoped
  should be the default; styling the whole document should take an explicit grant.
- **The services know nothing of Brevity.** The HTML actor (and any styling service beside it)
  speaks in Opre addresses. Brevity is one client, which lowers its syntax to messages.

## Options first surveyed

1. **`<style>` owned by the class**, shared by all its actors and injected once.
2. **CSS custom properties bound to cells:** `style={ "--accent: " + accent }`. That works today;
   `accent <- "red"` restyles one element.
3. **Rules as typed Objects** checked against a CSS manifest, as `domManifest` checks
   attributes. Validated, but reads worse than CSS.
4. **A sibling file:** `card.bv` + `card.css`. The least invention, with editor tooling for free.
5. **Shadow DOM per class.** The strongest encapsulation, but it fights global styles, forms and
   accessibility tooling. Kept as a later option.

## Targeting the maker's root

`:scope { … }` is noisy. Instead:

- **Bare declarations style the root.** `<style>padding: 1rem; h2 { margin: 0; }</style>`: the
  declarations are for the root, and nested rules are for its descendants. It reads like the
  `style=` attribute grown into a stylesheet. The compiler can wrap top-level declarations in
  `& { … }`, so this doesn't depend on browser support for bare declarations in `@scope`.
- **`&` names the root when needed:** `&:hover`, `& > h2`, `&.selected`. Inside `@scope`, `&` is the
  scope root.
- **Rejected: the class name as a selector** (`Card { … }`). HTML element names ignore case, so
  `Card` would also match any `<card>` element.

## Delivery vs matching

Two separate questions: how rules reach the browser, and how a rule finds its elements.

- **Inline `style="…"` alone can't express:**
  - pseudo-classes (`:hover`), pseudo-elements (`::before`)
  - media and container queries
  - descendant rules

  It also wins every specificity contest, so page authors can't override it.
- **Generated classes alone** need a stylesheet anyway (a class is only a selector), and they
  scale badly for per-actor values: 100 cards with 100 colours means 100 classes.
- **Hybrid:** static rules go in a shared sheet matched by a stable per-maker marker; per-actor
  values go in inline custom properties (`style="--x: teal"`). Toggled classes remain for state
  (`&.open` with `class={ … }` driven by a cell).

### Constructable stylesheets

`new CSSStyleSheet()` + `document.adoptedStyleSheets`: no tag in the DOM, and the sheet is an
object you send changes to, so it looks naturally actor-shaped. Dependable in all major browsers
(Safari since early 2023); Lit uses them by default. Updates (`replaceSync`, `replace`,
`insertRule` / `deleteRule`, `cssRules[i].style.setProperty`) apply live to every adopter.

Caveats:

- **Invisible to serialization.** `outerHTML`, "save page" and server rendering don't include
  them, so `innerHTML`-based tests don't see them. That's a problem for the progressive-enhancement
  idea in `bvx-conclusions.md`.
- **One document per sheet.** The viewer's iframe builds its own.
- **Cascade order.** Adopted sheets come after `<style>` / `<link>` sheets and win ties. Use
  `@layer` if page authors should be able to override.
- **Editing a shared rule restyles everything it matches.** That's wrong for per-actor values, and
  right for state shared by all of a maker's elements (see the reactive `for=` sheet below).
- **Mostly silent errors.** Bad declarations are dropped. `insertRule` throws; `replaceSync` doesn't.
  Generated rules should be validated by the compiler.
- **No `@import`.** DevTools lists them as "constructed" sheets.

## Per-actor (dynamic) values

### Lowering to custom properties

```brevity
Card = (accent *Text) *{
  <style>border-left: 4px solid { accent };</style>
  …
}
```

lowers to a class sheet (once), `border-left: 4px solid var(--…)`, plus each actor's root
subscribing that variable to its own `accent`. It's the same lowering templates already do: a
text node subscribes to `{ count }`; here a custom property subscribes to `{ accent }`. Custom
properties inherit, so nested elements see the value, and a nested `Card` shadows its parent's.

Limits:

- **Values only.** A selector (`.{ kind }`) or a property name can't lower to `var()`. That should
  be a compile error; `class={ kind }` covers the selector case.
- **Units:** `{ n }px` needs `calc(var(--x) * 1px)`, or a value that carries its own unit.
- **Variable names per block** (not just `--bv-0`), so values can't leak through inheritance
  across makers.
- **Merging with an author-written `style=`** on the same element.

### Per-element sheets (synthesized id)

If ids are unique (enforced), one can be synthesized for each reactive element, which then gets
its own sheet. That buys what `var()` can't make dynamic:

- media and container query conditions: `@media (min-width: { bp }px)`
- selectors, property names, `@keyframes` parts

Costs:

- **Scale:** 2,000 list items means 2,000 sheets or rules.
- **Specificity:** `#id` beats classes; use `:where(#id)` or `@layer`.
- **Lifecycle:** the sheet must be removed when the actor dies.
- **Collisions** with author-written ids.

### Tiered lowering

The compiler decides per slot:

- a value-position `{ }` → an inline custom property
- a structural `{ }` → that element gets its own scoped style
- static rules → the shared sheet

The author writes one form, and the cost scales with how dynamic the style is.

## `<style>` as a child element, with `@scope`

Standard HTML today. An `@scope` block with no selector, inside a `<style>`, applies to that
`<style>`'s parent element. So the browser does the targeting, with no ids and no sheet
management. The style is removed along with its element, so lifecycle cleanup is free, and it
appears in serialized HTML.

**Verified 2026-11-08 in Chromium 147, with no runtime changes** (`docs/site/scope-test/`,
untracked):

```brevity
@color *Text = "rgb(0, 0, 0)"

<p>
  <style>{ "@scope { :scope { color: " + @color + "; font-size: 24pt; } }" }</style>
  scoped
</p>
```

- **Before:** the scoped `<p>` is black at 32px, and its sibling `<p>` is untouched at 16px.
- **After an outside `#set` of `@color`:** only the scoped `<p>` turns red.
- **Mechanism:** the existing reactive text-node subscription rewrites the `<style>`'s text.

Firefox arrived at `@scope` later than Chrome and Safari; check before relying on it. The
CSS braces only survive here because they sit inside a string literal (see "Interpolation").

**Where this form fits, and where it doesn't.** Nesting a `<style>` in every element a maker
returns is dishonest for the ordinary case, a single maker sharing one style definition:

- It clutters the template.
- The compiler would (or should) extract it anyway.
- Resending the style with every element created is wasteful.

The child-`<style>` form stays right for one-off styles on an inner element, which need no maker
identity.

## Naming the shared sheet's selector

- **No synthesized names or `bv-` prefix.** The maker already has an address, and the address is
  the identity, unique per document after parent translation (the same frame `ty` uses).
- **As a class name,** spaces are illegal, so `main @Para` → `main@Para` (`.main\@Para`). Keep the
  `@`: `main-Para` could collide with a file named `main-Para`, while `@` is the address delimiter,
  so the mapping is one-to-one.
- **As an attribute,** the literal address works as is: `[ctor="main @Para"]`. That line of
  thought became `ctor` (see `ctor-provenance-2026-11-09.md`): the HTML service stamps the maker's
  address on the root element, with `@scope ([ctor="…"]) to ([ctor])` as the boundary.

## `<style for={ @component }>`: shared styles at file level

```brevity
@component = (params) *{
  …
  return <div>…</div>
}

<style for={ @component }>
  padding: 1rem;
  h2 { margin: 0; }
</style>
```

- **Once, without extraction tricks.** File-level statements run once, at file init; a class's
  constructor block runs per actor (the wasteful version).
- **The association is checked:** `{ @component }` is a real member reference, translated to
  `main @component`. A misspelled name is a compile error. It works the same for classes and
  functions. It has HTML precedent in `<label for=…>`.
- **It's a declaration, not a dangling statement.** At first it looked like a smell (calling a
  constructor and discarding the address). It's side-effecty in the same way file-level
  registration already is: `@make = …` registers a handler, and `body.append!(page)` is run for
  its effect.
- **The effect has an owner.** The sheet is created on the requester's behalf, so its lifetime can
  be tied to that actor's: when it dies, HTML removes the sheet.
- **Binding it gives a handle:** `theme = <style for={ @Para }>…</style>`, then
  `theme.disabled <- true`.
- **Service side:** a `#new` of `style` carrying `for` doesn't put a `<style>` in the page. HTML (or a
  separate `CSS` actor) wraps the content as `@scope ([ctor="main @component"]) to ([ctor]) { … }`
  and adopts it once.
- **Verified 2026-11-08:** a bare file-level element statement already compiles and sends its
  `#new` at init (`<style>plain</style>` → `#new` to `HTML @style`).

### A reactive `for=` sheet

The shared sheet can itself be reactive. Its state is held by the actor that declares both the
maker and the `<style>`. `density <- "compact"` rewrites one sheet, and every element it applies
to restyles. There's no class toggling on each element and no per-element bookkeeping. This is
very different from class-toggle micromanagement, and worth exploring in its own right.

This is a different design from per-instance custom properties, and the two were conflated once
in discussion:

- **Reactive `for=` sheet:** enclosing-actor state; one sheet rewrite; all of the maker's elements
  change together.
- **Custom properties per instance:** each actor's own values on its own root; one element
  changes.

Per-instance values *inside* a shared style (`{ @color }` naming a maker's cell) would lower to
`var(--…)`, with each instance setting the variable on its root. For function makers that needs
template closures to see a function's locals, which they can't yet (`session-2026-11-07-
examples-viewer.md`).

## Interpolation and CSS braces

**The collision is real (verified):** `<style>h2 { margin: 0; }</style>` fails to compile with
`Unexpected DomConstructor child: interp`, because `{ margin: 0; }` parses as an interpolation.

**Existing forms (checked in the lexer and parser):**

- In element content: `{ expr }` is a reactive closure, `#{ expr }` is a snapshot splice, and `\{`
  escapes a literal brace. (CSS is technically writable today with `\{`, just ugly.)
- **Attributes are whole-field.** A quoted literal (no interpolation), or a single `{ expr }` as the
  entire value. Partial assembly happens inside the expression. Element content is the only place
  text and interpolation mix.

**Making reactivity explicit in the slot types.** Today every `{ }` in every slot makes a closure
and a subscription, whether the receiver wants a live value or not. That's unintended reactivity
throughout the language. So the docs should say which slots accept a subscribable:

```
class: Text | &Text                   // HTML only subscribes, never writes, so read-only
children: List of (Text | &Text)      // <div>
children: List of Text                // <style>: no reactive interpolation
```

(`&` per the capability sigils note: read-only ref. Check against its current version.)

That locks reactive interpolation out of `<style>`. But **defining a new interpolation syntax is
language-specific, not HTML's business**, so it doesn't belong in the service doc. Considered and
set aside:

- **A content model in the manifest** declaring a raw mode or a different opener: it puts
  language syntax in a service's docs.
- **A use-site marker** on the element: explicit, but every `<style>` would have to say it.

**Resolution (proposed): `{{ }}` for text interpolation, language-wide.**

- `{ }` is a whole field: `class={ @kind }`, `onclick={ … }`.
- `{{ }}` interpolates within text: `<p>Hello, {{ @name }}</p>`.
- A lone `{` in content is always literal, in any element. CSS, code samples and prose with braces
  just work, and no per-tag override exists anywhere. Vue has the same split; `{{ }}` is familiar
  from Handlebars, Mustache and Jinja.
- **CSS check:** `{{` doesn't occur in valid CSS (a nested rule needs a selector between braces).
  `}}` occurs constantly but is harmless: the lexer only looks for `}}` after an opener, counting
  nested braces inside the expression.
- With the syntax settled, the slot types (`Text | &Text`) go back to their real job: catching
  unintended reactivity, not deciding how braces parse.

Costs:

- **Churn:** every `{ }` in element content (tests, examples, `viewer.bv`) becomes `{{ }}`.
- **The snapshot form** needs a matching spelling (`#{{ }}`?). String literals have no brace
  problem and could keep `#{ }`, at the cost of two spellings for one idea.

## The singleton consequence

With classes as singletons (`classes-as-singletons-2026-11-09.md`), a class's style can live in
its class block:

```brevity
@Widget = **{
  <style>…</style>
}
```

- **The sheet side needs no annotation.** The `<style>` runs once, when the singleton is created,
  and its `#new` arrives with `from: 'main @Widget'`. The envelope names the maker, so `for=` is
  unnecessary.
- **The element side still needs a link.** An instance's elements arrive with `from` set to the
  instance. Either:
  - **instances nest under their class singleton** in the CAM tree (`main @Widget/1` under
    `main @Widget`; the class actor creates them), so HTML derives the class as the parent of
    `from`. That's structural, not a naming convention, but it must hold on every target. Or:
  - the instance's `#new` carries `ctor`.

  If nesting holds, classes need no `ctor` at all.
- **Functions still need `for=` + `ctor`.** `@template` runs inside `main`, so its elements arrive
  `from: 'main'`. Alternatively, a function that wants its own styles can become a class.
- **Side effect:** HTML can't tell the root, so deriving from `from` stamps every element an
  instance creates. That's fine for matching, and it makes the `to ([ctor])` boundary unnecessary,
  at the cost of more attributes in the DOM.

## Recommendation, as it stands

- **Shared styles:** in the class singleton block (`**{ <style>… }`), or `<style for={ @maker }>`
  for function makers. One adopted sheet per maker, scoped by the maker's address.
- **Shared reactive styling:** the `for=` / class-block sheet reacts to its enclosing actor's state.
- **Per-instance values:** custom properties on each root.
- **One-off inner-element styles:** a child `<style>` with native `@scope`.
- **Interpolation:** `{{ }}` language-wide; `{ }` whole-field. Slot types declare reactivity.

## Open

- `{{ }}` migration, and the snapshot spelling (`#{{ }}`, and whether strings follow).
- Raw-text lexing of `<style>` content until `{{ }}` lands; today CSS braces break compilation.
- Whether instance addresses nest under the class singleton on every target.
- `@scope` in Firefox; `to ([ctor])` not treating the root itself as a limit.
- Bare declarations directly inside `@scope`: browser support, or always compiler-wrapped.
- Units in value-position lowering (`calc` vs unit-carrying values).
- Several shared `<style>`s for one maker (naming / ordering).
- Relocation: a hand-written override for an address stops matching when the app is mounted
  elsewhere.
- **`style` is not declared in the HTML manifest,** yet `HTML: (:style)` was accepted. Either
  undeclared tags fall through the validator, or something else matched. Check whether a typo
  (`:sytle`) compiles silently.
