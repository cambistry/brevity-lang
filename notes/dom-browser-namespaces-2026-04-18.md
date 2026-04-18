# DOM and Browser namespaces (2026-04-18)

Conversation about how to organize browser platform APIs into namespaces for Brevity's browser target.

## Two service actors, not one

The browser platform surface splits into two distinct actor-addressable services:

- **`DOM`** — the document tree. Element constructors (`DOM.div`, `DOM.p`, `DOM.span`) and the document singleton (`DOM.document`). Everything that participates in the document object model.
- **`Browser`** — the host runtime. `Browser.fetch`, `Browser.localStorage`, `Browser.navigator`. Capabilities that exist only when the host is a full browser (not a WebView, not a native renderer).

The split follows the actual spec boundary: the DOM is portable across any context that renders HTML. Browser runtime APIs are not.

## Why namespaces matter (actor model alignment)

The namespace isn't just organizational — it represents the actor your code is messaging. `Browser.fetch` reads as "ask the Browser service to fetch," not "I have a local fetch capability." This preserves Brevity's principle that platform APIs are remote/external services, not folded-in local capabilities.

A `.bv` actor doesn't suddenly know how to `fetch`. It's in conversation with a service that can.

## Element constructor casing is programmer's choice

`DOM.div` and `DOM.Div` both resolve to the same constructor at the same address. Since each is a constructor with a single, definite identity, casing is cosmetic — no aliasing needed, just two valid spellings. The programmer destructures whichever form they prefer and gets the exact same result.

In practice, lowercase (`div`, `p`, `img`) will dominate because that's what every web developer already knows. But uppercase (`Div`, `P`) is equally valid for those who prefer Brevity's type-capitalization convention. Either way, browser intrinsics remain visually distinct from user-defined components by provenance (imported from `DOM`) rather than by casing rules.

## `document` belongs in DOM; `window` does not

`document` is the root of the DOM tree — it's literally part of the Document Object Model. `DOM.document` is accurate.

`window` is the host environment that *contains* the DOM. It's the BOM (Browser Object Model), a separate spec concern. It doesn't participate in the document tree. Its capabilities (`fetch`, `localStorage`, `navigator`, etc.) live under `Browser`.

The name `window` itself is a historical accident from Netscape circa 1995 — it's really a global namespace object, not a window. Brevity doesn't need to carry that baggage.

## Platform-aware rendering (sketch, not settled)

The DOM/Browser split suggests capability-driven platform injection:

```
<:DOM *, :Browser *> { ... }   -- full browser context
<:DOM *>             { ... }   -- rendering-only (WebView, native)
```

A WebView is basically a rendering engine — it has DOM but typically no `Browser.fetch` or `Browser.localStorage`. Those capabilities live on the native side, which is a different actor with a different address.

This could leverage optional arg binding to express platform shapes. A constructor that needs both DOM and Browser would render in browsers; one that only needs DOM could render anywhere with a document tree.

This is a bigger conversation about platform awareness — noted here as a direction, not a decision.

## Relationship to prior notes

- `dom-as-actor-subsystem-2026-04-13.md` — established that the DOM is a first-class actor subsystem; this note names and organizes the namespace around that principle
- `browser-target-2026-04-01.md` — earlier browser target thinking; this note refines the API surface organization
