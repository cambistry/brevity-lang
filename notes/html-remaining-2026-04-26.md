# HTML Element surface — remaining groups

Captured 2026-04-26 after the query-methods landing (`13d0072`). Tracks what's
still un-wrapped on `Element`/`Document` in the HTML browser service.

Updated 2026-04-26 after layout/scroll/focus/cloning landing (`d227a76`):
geometry, scrolling, focus/blur/click, cloning/equality/normalize all
shipped on Element + Node.

## Groups

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

1. ~~Layout/geometry + scrolling + focus + cloning~~ — shipped in `d227a76`.
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
