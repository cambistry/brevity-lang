# Reactive DOM binding lifecycle (JS target) (2026-04-13)

Notes on lifecycle/retention concerns for the closure→DOM subscription model from `reactive-closures-2026-04-13.md`. Scope is the JS target specifically, where reactive closures subscribe to DOM update functions attached to actual DOM elements.

## The underlying mechanic

DOM elements in JS are regular objects. You can attach arbitrary properties to them — including functions. The browser doesn't care. So a compiled Brevity template can emit something like:

```js
const p = document.createElement('p');
p.$updateContent = value => { p.textContent = value; };
closure.subscribe(v => p.$updateContent(v));
```

The element carries its own update logic as a property. The closure calls it when its value changes.

This is trivial to make work for the simple case. The engineering is all in the lifecycle — making sure subscriptions don't outlive the elements they update, and making sure elements can be garbage-collected when they're removed from the DOM.

## Recommended property-naming: `Symbol` over `$prefix`

```js
const BV = Symbol.for('brevity.update');
p[BV] = new Map();
p[BV].set('content', v => { p.textContent = v; });
```

Two reasons Symbol beats a string prefix like `$bv`:

1. **Real collision safety.** DOM elements get new properties over time as the web platform evolves. Any string-named property could in principle collide with a future `HTMLElement.prototype.something`. A Symbol can't collide with anything because it's a unique value, not a string key.
2. **Not enumerable by default.** Symbol-keyed properties don't show up in `for...in` or `Object.keys()`, so they don't pollute iteration over the element's own properties.

`Symbol.for('brevity.update')` gives a globally-shared symbol that multiple compiled modules can agree on without needing to export or import it.

## The three lifecycle gotchas

### 1. GC / retention

If the closure holds a reference to the element (directly or via a bound method like `p.$update.bind(p)`), the element can't be garbage-collected when it's removed from the DOM. The closure's subscription keeps a live reference, the subscription keeps the element alive, the element keeps its attached properties alive. Memory leak.

Three standard fixes:

- **WeakRef**: the closure holds a `WeakRef` to the element. When the element is GC'd, the weak ref returns `undefined` on `.deref()`, and the subscription self-cleans on the next notification.
  ```js
  const ref = new WeakRef(p);
  closure.subscribe(v => {
    const el = ref.deref();
    if (!el) { /* unsubscribe */; return; }
    el[BV].get('content')(v);
  });
  ```
  Downside: the element isn't reclaimed until the next update fires, which may be never for stable bindings.

- **MutationObserver**: watch the document tree for removed nodes and explicitly unsubscribe when a tracked element disconnects. One observer per document handles all elements.
  ```js
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.removedNodes) {
        cleanup(node);  // unsubscribe everything attached to node
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  ```
  Downside: adds one global observer that fires on every DOM mutation. Probably fine at scale but worth measuring.

- **Custom elements with `disconnectedCallback`**: if the reactive element is wrapped in a custom element, the browser tells you when it leaves the DOM via the lifecycle callback, and you can tear down subscriptions there. Most principled but adds a custom-element wrapper where a plain element would do.

**Recommended default for Brevity's JS target:** MutationObserver on `document.body` with `subtree: true, childList: true`. One observer, zero per-element overhead, zero user-facing complexity. When a node is removed, look up its `p[BV]` map, find the cleanup list, call all the unsubscribe functions.

### 2. Cleanup storage on the element itself

The element should carry its own cleanup list so the MutationObserver (or any other cleanup mechanism) can find it without a separate registry:

```js
p[BV] = new Map();
p[BV].set('content', v => { p.textContent = v; });
p[BV].set('_cleanup', []);  // array of unsubscribe functions

const unsub = closure.subscribe(v => p[BV].get('content')(v));
p[BV].get('_cleanup').push(unsub);
```

On removal:
```js
function cleanup(node) {
  if (!node[BV]) return;
  const list = node[BV].get('_cleanup');
  if (list) for (const fn of list) fn();
  node[BV].clear();
}
```

The cleanup list lives on the element itself, so when the element is removed and its subscriptions are torn down, the element is then free to be GC'd. Self-contained per-element state.

### 3. Identity stability of held methods

Don't do this:

```js
closure.subscribe(p[BV].get('content'));
```

This captures the current update function by value. If anything later reassigns `p[BV].set('content', ...)`, the closure's subscription still holds the stale old function. This is subtle and hard to debug.

Do this instead:

```js
closure.subscribe(v => p[BV].get('content')(v));
```

The lambda looks up the current function on each call. Small per-call overhead (one Map lookup), but the binding stays live through reassignment and the intent is clearer.

## The compiled-output sketch, putting it together

For `<p class={ @style }>{ @content }</p>`:

```js
const p = document.createElement('p');
const BV = Symbol.for('brevity.update');
p[BV] = new Map();
p[BV].set('content', v => { p.textContent = v; });
p[BV].set('class', v => { p.className = v; });
p[BV].set('_cleanup', []);

p[BV].get('_cleanup').push(
  closure_content.subscribe(v => p[BV].get('content')(v))
);
p[BV].get('_cleanup').push(
  closure_class.subscribe(v => p[BV].get('class')(v))
);
```

And one global MutationObserver (set up once per document by the runtime) handles the cleanup side when any of these elements is removed from the tree.

## What this doesn't cover

- **Cross-boundary case**: if the reactive closure is hosted in a different process/language (Rust actor producing values for a JS DOM), the subscription is a real message across the CAM tree, and the JS side needs a bridge. That's the Brevity runtime's job, not per-element logic. The per-element side is still just the `p[BV]` callback map — the bridge delivers values to it the same way a local closure would.
- **Batching**: if many closures fire in quick succession (e.g., one parent state change triggers ten dependent closures), you may want to batch DOM updates into a single animation frame. That's a runtime-level concern, orthogonal to per-element lifecycle.
- **Reentrancy**: if an update function mutates DOM in a way that triggers another closure to re-evaluate (rare with text/attribute updates, possible with layout-sensitive reads), you can get cascading updates. Worth being aware of but probably not a concern for the common case.

## Cross-references

- `notes/reactive-closures-2026-04-13.md` — the reactive closure model this implements on the DOM side
- `notes/implicit-return-is-projection-2026-04-10.md` — the `self as Element` projection model
- `notes/actor-as-constructor-2026-04-10.md` — the actor-as-constructor shape for templates
