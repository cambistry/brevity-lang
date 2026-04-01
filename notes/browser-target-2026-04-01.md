# Browser Target: BVX and brevity.js

## Core Insight

The browser target is NOT another codegen. It's the existing JS codegen + a browser host runtime (`brevity.js`). Same relationship as `rust/src/main.rs` or `erlang/brevity_actor.erl` — a host that wires generated actors to an environment. No fork, no divergence, no feature drift.

## Architecture

```
brevity.js = extract() + compile(ast, { target: 'js' }) + browser actor runtime
```

The compiler runs in-browser (~20 KB gzipped). The generated JS actor classes are identical to what the JS target produces today. What changes is the **host** — the `binding` passed to `create()` targets the DOM instead of posting messages upstream.

## BVX as Superset

- `.bv` — pure Brevity, no DOM awareness, compiles to any target
- `.bvx` — BV + element literals, compiles to JS only (browser host)

## Identity: The File is the Actor

### Document (root actor)

`<script src="app.bv" id="document">` — explicit binding. The `id="document"` is a framework convention (valid HTML — `id` is a global attribute). Handlers in `app.bv` are handlers on document:

```
@ready
  -- DOMContentLoaded. That's it. That's the handler.

@click selector "#btn"
  -- document-level event delegation, naturally
```

Must be explicit. No auto-inference of which script is `document` in v1.

### Elements (child actors)

Elements declare their own behavior inline:

```html
<p id="counter" data-src="counter.bv">0</p>
```

`brevity.js` walks the DOM on load, finds every `[data-src]`, wires each element to its actor file. The DOM tree IS the actor tree — literally, not by metaphor.

(`data-src` rather than bare `src` because `src` is not spec-valid on arbitrary elements. Browsers won't choke on bare `src` but `data-src` is zero-risk.)

## The Runtime (~200 lines)

`brevity.js` on load:
1. Find all `<script src="*.bv">` — compile via `extract()` → `compile()`, eval, bind root to `document`
2. Find all `[data-src]` elements — compile each, bind to the element
3. Provide `binding.post()` that targets the DOM (e.g., `::content` → `el.textContent`)
4. Wire DOM events to `actor.receive()`
5. Actor-to-actor messaging via `querySelector` addressing: `"#counter".inc` dispatches to that element's actor

## JS Interop

A JS module at a path is an actor reference:

```
result = *"./math.mjs".compute x y
```

JS modules speak CAM via a standard wrapper:

```js
import { actor } from 'brevity';

export default actor({
  compute(x, y) { return x + y; }
});
```

The wrapper maps verbs → functions, packs/unpacks structures, handles replies. One import, one call, CAM citizen. Raw `receive(msg)` also supported for full control.

## Testing

No new test infrastructure for the compiler — existing JS target tests cover codegen as-is. New test coverage is for the **host runtime only**:
- Does `binding.post({ verb: '::content', ... })` update `el.textContent`?
- Does a `click` event dispatch `receive()` on the target actor?
- Does `@ready` fire on `DOMContentLoaded`?

Use `happy-dom` or `linkedom` for fast in-process DOM tests. Playwright for integration tests that need a real browser.

## Open Questions

- Element attribute syntax: Brevity uses `name Type = value`, HTML uses `name="value"`. Unify or context-switch?
- `document` as actor: `::content` doesn't make sense on document. Root actor's public interface is DOM-global operations (event delegation, title, head). Element-as-actor semantics kick in one level down.
- Event delegation model: does `@click selector "#btn"` live on the root actor, or does `#btn` get its own actor? Probably both are valid — delegation for lightweight cases, dedicated actors for stateful elements.
