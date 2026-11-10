# `ctor`: which member made an element — 2026-11-09

Design discussion, not implemented. How an element records the member (class or function) that
made it: how that's determined, how it travels the wire, and how it shows up in the DOM. The
first consumer is shared per-maker styles (`<style for={ @component }>`); it also gives DevTools
legibility and stable selectors for tests and page authors.

## What it names

The **member whose result the element is**: a class or a function, by its address.

```brevity
@component = (params) *{ … return <div>…</div> }   // → ctor "main @component"
@template  = (params) -> <div>…</div>              // → ctor "main @template"
```

Both are addressable members of `main`, so both have a real address. It names neither the
instance nor the file (unless the element is made at file level, when it's `main`; the file is
the actor).

**Name:** `ctor`. "Constructor" is the accurate word for the role, whatever made this, class or
function, but it's too heavy for an attribute that appears everywhere. Rejected names:

- `owner`: suggests the instance.
- `of`, `kind`, `made-by`: too vague, or suggest an instance.
- `cls`: names only half the cases.

(Brevity's own vocabulary retired "constructor" as a noun. This is HTML / Opre vocabulary.)

## How it's determined

**The compiler, lexically.** It knows which member a template sits in.

- **Root only.** Only the `#new` whose result is the member's returned result carries `ctor`: the
  outermost element of the tail / return-as expression (each tail, if there are several return
  paths). In `@create = -> <div><p>hi</p>{ count }</div>`, the `<div>`'s `#new` carries it and the
  `<p>`'s doesn't; the `<p>` is an internal part.
- **Nested makers:** the innermost lexical maker wins. `@component` calling `@template` gives the
  template's root `main @template`, and the component's own root `main @component`.
- **Forwarding:** in `@a = -> #b()`, the element was built and stamped by `#b`; `@a` only forwards
  it and can't re-send its `#new`. An element belongs to the maker that built it. Marking a
  forwarded element would take a separate, deliberate `set` of the attribute.

**Why it can't be read from the envelope:**

- `ty` on a `#new` mirrors the *args* (since `e228d4e`), and is absent when there are none.
- `from` is the actor (`main`). Functions run inside `main`, so `from` can't say which member
  built the element.

## On the wire

**An optional Opre envelope key on `#new`**, beside `id` / `to` / `from` / `ty`. It describes the
request, not the element's content, so it goes in the envelope, not the args Object (where it
could also collide with a real HTML attribute). It can extend to other factory verbs, if any
arise; the test is whether the receiver creates something persistent that it attributes to the
sender. It is not a general key on every message.

Today's `#new` for `<div class="card" onclick={ count <- count + 1 }><p>hi</p>{ count }</div>`
(verified), as it leaves the actor:

```js
{ id: '2', op: [{ children: ['#<HTML @p/1>', '#<@0>'], class: 'card', onclick: '#<@1>' }, '#new'],
  to: 'HTML @div' }
```

With `ctor`, as received by HTML after translation:

```js
{ id: '2', op: [{ … }, '#new'], to: 'HTML @div', from: 'main', ctor: 'main @create' }
```

- **Local form, translated like `from`.** The sender writes `ctor: '@create'`; each parent prefixes
  its alias on the way out. HTML gets an address that's correct for its frame, wherever the app is
  mounted.
- **Not a return address.** Replies still go to `from`. Folding it into `from` (`main @create`)
  would route replies to the `@create` handler, which in CAM means calling it.
- **Advisory, unauthenticated.** It's rewritten on every hop, so it lives with the hop-mutable
  routing headers, outside Bluster's signed payload. Fine for styling and debugging; never used
  for authorization. A sender can only name its own members, since local forms get its address
  prefixed.
- **Optional.** Absent means unknown. Receivers must not require it; clients needn't send it.
  Brevity must send it whenever a `<style for={ … }>` refers to the maker. Sending it always vs
  only when referenced is a compiler choice.
- **A local `C()` sends no `#new`** (in-process creation), so anything carried on `#new` must also
  be applied on the local path. Element `#new`s always go to the HTML service, so DOM stamping is
  unaffected.

## In the DOM

The HTML service copies `ctor` to an attribute, verbatim:

```html
<div ctor="main @component">…</div>
```

- **HTML knows nothing of Brevity.** An actor asked it, over Opre, to make an element; `ctor` is
  its record of which member asked. Any client language can send it. No `bv-` prefix, and no
  synthesized or hashed names: the address is the identity.
- **The literal address, space included.** Class names are space-separated, which forced
  `main@Para` there; attribute values aren't, so `[ctor="main @Para"]` matches the wire form
  exactly.
- **Not `class`.** That's author territory: every `class={ … }` update would have to merge with
  it, and `el.class <- "x"` would strip it.
- **Root only, scoped with `@scope … to`.** Precision over descendants comes from the CSS boundary,
  not from stamping every element:

  ```css
  @scope ([ctor="main @Para"]) to ([ctor]) {
    h2 { margin: 0; }
  }
  ```

  Para's elements, down to (and excluding) any other maker's root, so a nested `Card` is skipped.
- **Edge cases:** file-level elements get `ctor="main"`; private makers get `main #panel` (the same
  exposure `ty` already accepts).

## Consumers

- **`<style for={ @component }>`** at file level: runs once at file init, and HTML (or a `CSS`
  service actor) adopts it as one sheet scoped to `[ctor="main @component"]`. Its reactive state
  is held by the actor that declares both the maker and the `<style>`.
- DevTools, tests, and page-author overrides.

## Open

- **Relocation:** if the app is mounted under another actor, the translated address changes. The
  page stays consistent, but a hand-written override for the old address silently stops matching.
- **Inheritance:** whether a subclass's root should carry its chain (needs a separator, or a second
  attribute, since `~=` splits on spaces).
- **HTML validity:** `ctor` is a non-standard attribute; `data-ctor` if strict validity matters.
- **`@scope` limit behavior:** confirm that `to ([ctor])` doesn't treat the scope root itself (which
  has `ctor`) as a limit. The nested-`.card` pattern suggests it doesn't.
- **HTML's own `#new` carries no `ty`** for its args (all strings and addresses), unlike other
  receivers since `e228d4e`. Is that a gap?
