# HTML Element surface — remaining groups

Captured 2026-04-26 after the query-methods landing (`13d0072`). Tracks what's
still un-wrapped on `Element`/`Document` in the HTML browser service.

## Groups

### Layout / geometry (read-only)
- `getBoundingClientRect()` → DOMRect (x, y, width, height, top, right, bottom, left)
- `getClientRects()` → DOMRectList (per-fragment for inline elements)
- `clientWidth`, `clientHeight` (Integer — inner dimensions excluding scrollbar)
- `clientTop`, `clientLeft` (Integer — border thickness)
- `offsetWidth`, `offsetHeight` (Integer — border-box dimensions)
- `offsetTop`, `offsetLeft` (Integer — relative to offsetParent)
- `offsetParent` (Element | null — nearest positioned ancestor)
- `scrollWidth`, `scrollHeight` (Integer — including overflow)
- `scrollTop`, `scrollLeft` (Decimal R/W — current scroll position)

### Scrolling (mutators)
- `scroll(x, y)` / `scroll(options)`
- `scrollTo(x, y)` / `scrollTo(options)` (alias for scroll)
- `scrollBy(x, y)` / `scrollBy(options)` (relative)
- `scrollIntoView(options?)`

### Focus / activation (mutators)
- `focus(options?)` — `preventScroll` option
- `blur()`
- `click()` — synthesizes click; runs default actions

### Events (mutators + design work)
- `addEventListener(type, listener, options?)`
- `removeEventListener(type, listener, options?)`
- `dispatchEvent(event)` → Boolean (`!event.defaultPrevented`)
- All `on*` handler properties (alternative form, but addEventListener covers them)

**Design open**: listeners are JS callables; need a wire shape mapping
"event arrival on this element" to a Brevity-side message. Likely a
subscription model where the runtime mints a JS-side trampoline that
forwards events as messages to a Brevity actor address (similar to how
text-node closure subscriptions work today). Event objects themselves
are big — needs a Brevity-typed Event subset, not a passthrough.

### Style / dataset / attributes (sub-reps)
- `style` → CSSStyleDeclaration (inline-style proxy)
- `classList` → DOMTokenList (`.add`/`.remove`/`.toggle`/`.contains`/`.replace`)
- `dataset` → DOMStringMap (data-* as a string map; dynamic keys)
- `attributes` → NamedNodeMap (live list of Attr nodes)
- `computedStyleMap()` → StylePropertyMapReadOnly
- `attributeStyleMap` → StylePropertyMap (Typed OM)

Each maps to a sub-rep in the Aria pattern — a separate addressable actor
backed by the same Element. classList + dataset are the high-value pair.

### Cloning / equality
- `cloneNode(deep?)` → Node
- `isEqualNode(other)` → Boolean (structural equality)
- `isSameNode(other)` → Boolean (identity — just `===`)
- `normalize()` → void (merge adjacent text nodes)

### Shadow DOM
- `attachShadow({ mode, ... })` → ShadowRoot (introduces new node type)
- `shadowRoot` → ShadowRoot | null (open shadow root if any)

### Popover / fullscreen / pointer lock (async)
- `showPopover()` / `hidePopover()` / `togglePopover(force?)`
- `requestFullscreen(options?)` → Promise
- `requestPointerLock()` (async)

Async return shape needs Promise → reply mapping; not done yet.

### Animation (async)
- `animate(keyframes, options)` → Animation
- `getAnimations(options?)` → List of Animation

Animation objects have their own surface (play/pause/cancel/finish).

### Editing / a11y helpers
- `isContentEditable` (Boolean — effective state, inheritance-aware)
- `accessKeyLabel` (Text — localized access-key hint)
- `attachInternals()` → ElementInternals (form-associated custom elements)

## Suggested order

1. **Layout/geometry + scrolling + focus + cloning** as one batch —
   shallow plumbing on the same patterns we already have. DOMRect can
   come back as a Structure literal `{x, y, width, height, ...}` rather
   than minting an actor. Highest ratio of value-to-design-work.
2. **classList + dataset** as a pair of sub-reps following the Aria
   pattern. `style` is bigger (~300 properties) so split off if needed.
3. **Events** — needs design conversation first about subscription wire
   shape and Event-object subset before any code.
4. Shadow DOM, async groups (popover/fullscreen/animation) last —
   each introduces a wire-protocol question (new node types, async
   replies) that's not yet load-bearing.

## Also pending (from earlier note)

`notes/html-deferred-2026-04-26.md` — text-node `set node_value: (Text)`
and Aria sub-rep dedup. Both small; could ride along with the next pass.
