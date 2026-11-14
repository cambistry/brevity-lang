# `from` naming the calling scope — 2026-11-14

Proposal, undecided, not implemented. The idea: every outgoing call would carry, in `from`, the
address of the programmatic scope it was made in (the function or class whose code made the
call), not just the actor that holds that code. The motivation is stamping DOM elements with the
scope that commissioned them (see "Consumers"). If adopted, it would replace the separate envelope
key that `ctor-provenance-2026-11-09.md` needed because `from` names only the actor.

## The rule, as proposed

A call's `from` would be the address of the **innermost named, addressable scope** whose code
makes the call, written relative to the sending actor and translated by each parent on the way
out, as `from` is today.

```brevity
**
  HTML: (:div)
**

@template = { <div>123</div> }          // $new to HTML div, from: . template
@Constructor = *{ d = <div>456</div> }  // $new to HTML div, from: . Constructor
```

As HTML might receive them, after `main`'s parent translates them:

```js
{ id: '1', op: [{ children: ['123'] }, '$new'], to: 'HTML div', from: 'main template' }
{ id: '2', op: [{ children: ['456'] }, '$new'], to: 'HTML div', from: 'main Constructor' }
```

Today both arrive as `from: 'main'`.

Working assumptions, each open to revision:

- **Calls, not replies.** Every request (ordinary ops, silent `!` and launched calls, the
  intrinsics `$get`, `$set`, `$new`, `$subscribe`, `$update`) would carry the scope. Replies
  (`re` / `ex`) would stay as they are.
- **Wire names, as anywhere else.** Public bare (`. template`), protected `~` (`. ~helper`),
  private `#` (`. #panel`).
- **The file's own scope** (cell initialisers, file-level statements) would be the actor itself:
  `.`, or `from` left out, as today.
- **Nesting follows the address.** A class inside a class: `. Outer Inner`.

## Which scope

The current leaning, case by case:

- **A function** (`@f`, `#f`, lineal or braced): the function. `@template` → `. template`.
- **A class's constructor block:** the class, `. Constructor`. The actor is still being built and
  may not have an address yet; the code running is the class's. This would hold whether the
  class sends directly or a call is relayed through the file actor (`src/outer_reads.js`): at
  `main`'s boundary it would read `main Constructor`.
- **A closure or lambda** (including a `{{ }}` hole, `. @0`): probably its enclosing named scope.
  Closures are functions in lambda notation capturing `self`; if they carried their own `. @N`, a
  closure that builds elements would escape its maker's styles. Not settled.
- **Forwarding:** in `@a = -> #b()`, the calls `#b` makes would presumably carry `. #b`.

## Replies to a scope

If `from` stays a return address, the reply goes to it. Sketch of how that could work:

- **A function scope:** a `re` / `ex` addressed to `. template` would belong to the actor that
  holds `template`, matched by `id` as any reply is. All three targets already match replies by
  `id`; only the router for published actors reads `to` on a reply, and it would need to leave a
  reply addressed to a function member alone.
- **A class scope:** a reply addressed to `. Constructor` would go to the class, which would hold
  the pending table for constructions in progress and hand each reply on by `id` (ids unique per
  class, since constructions overlap). That would move the file actor's id renumbering for relayed
  class calls (`_outerFwd`, `bv_outer_call_`) into the class.

## `from` as a reply address only

A likely requirement: `from` would now name a function, and in CAM a request to `main template`
invokes `template`. So a receiver could send replies to `from` but never a request, nor build one
by adding a name to it. To call a sender back, it would use an address the sender handed over (as
HTML uses the `#<. @1>` lambda refs it is given).

## Trust

Presumably unchanged: `from` is a hop-mutable routing header, outside Bluster's signed payload.
Advisory, for replies, styling and debugging; never for authorization.

Costs to weigh:

- **Private and protected names would reach receivers** (`main #panel`). `ty` already exposes
  them; `ctor-provenance` accepted the same for HTML.
- **A refactor would change `from`.** Moving a call into a helper changes what the receiver sees.
  Only a receiver that treats `from` as "which actor" (per-caller state, rate limits) would
  notice, and that is arguably a misuse.

## Consumers

The motivating one is DOM provenance: the HTML service would copy `from` on each `$new` into an
attribute on the element it builds.

- **Name:** `creator` is the working favourite (`creator="main template"`): readable, with the
  precise meaning (the scope that commissioned the element, not the service that built it) held
  by `from`. `client` is the more defensible alternative. Considered and set aside: `ctor` (wrong
  for classes), `is` (standard, customised built-ins), `from` (SVG animation attribute), `source`
  (reads as a misspelt `src`), `origin` (web security meaning), `factory` (names HTML's side),
  `scope` (standard on `<th>`).
- **Which elements:** every element `C` builds carries the same `from`, internal parts included:

  ```brevity
  C = *{
    i *Integer = 0
    return <div><p onclick={ i <- i + 1 }>Click me</p><p>clicked {{ i }} time(s)</p></div>
  }
  ```

  Both `<p>`s and the `<div>` would carry `. C`. Two possibilities for HTML:
  1. **Stamp every element.** `p[creator="main C"]` selects `C`'s own parts directly, but the
     root isn't distinguished.
  2. **Stamp only where the creator changes:** an element gets `creator` only if its parent's
     differs or it has no parent. HTML can derive this from the tree with nothing extra on the
     wire, but children are dispatched first, so it has to drop the stamp on attach and recompute
     when an element moves. Gives the root-only stamp and `@scope ([creator="…"]) to ([creator])`.

  Option 2 looks closer to the intent (the `<div>` is what `C` commissioned).

Logs and DevTools would also gain the scope on every message.

## Open

- **Whether to do this at all,** versus a dedicated provenance key on `$new` only.
- **Methods called after construction:** `@C = *{ @make = { <div>789</div> } }`. By then the
  actor exists. `from` could be the class's member (`. C make`, the class routing the reply by
  `id`, as during construction) or the actor's (`. C 1 make`). The class form keeps every scope
  inside a class naming the class, which suits per-maker styling.
- **The outermost hop:** whether the node puts its alias in front of a relative multi-token
  `from` (`. template` → `main template`) as parents already do for published actors.
- **`return` in a constructor block:** `@C = *{ return <div>…</div> }` currently drops the element
  on all three targets. What it should mean (if anything) bears on how a class names its root.
