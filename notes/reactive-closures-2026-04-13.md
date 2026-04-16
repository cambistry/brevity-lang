# Reactive closures as addressable entities (2026-04-13)

The core reactive mechanism for Brevity's template/DOM system. Determines how dynamic content updates flow from actor state to DOM nodes, including across process and language boundaries.

## The model

A closure in a template expression (e.g., `{ content }` inside `<p>{ content }</p>`) is not just a function value. It is a **first-class reactive entity with its own address** in the actor tree. It has the same interface as a cell/ref: subscribe, receive current value, get notified on change. The only difference from a ref is that its value is computed rather than directly set.

## The mechanism

Given:

```
custom = <:content Text> {
  @content *Text = :content
  <p class="custom">{ content }</p>
}
```

### Construction

1. Parent actor creates `@content` cell with value `"initial"`.
2. Parent creates `closure_0` capturing `@content`. The closure is an addressable entity in the parent's process.
3. Parent wires a **local subscription**: `@content.subscribe(closure_0)`.
4. Parent passes `closure_0`'s **address** to the p-rep (not the function, not the ref — the address).
5. P-rep sends `subscribe(self)` to `closure_0`.
6. `closure_0` responds with its current value → `"initial"`.
7. P-rep creates a text node with `"initial"`, appends to `<p>`.

### Update (`widget.content <- "updated"`)

```
@content receives set("updated"), stores it
  → @content notifies closure_0 (local subscription within parent's process)
    → closure_0 re-evaluates in parent's process → "updated"
    → closure_0 compares old output ("initial") with new ("updated") → changed
    → closure_0 notifies p-rep → "updated"
      → p-rep sets textNode.nodeValue = "updated"
```

### Multi-dependency case

```
<p>{ @first + " and " + @second }</p>
```

The closure captures both refs. The parent wires both:
- `@first.subscribe(closure_0)`
- `@second.subscribe(closure_0)`

Either ref changing notifies the closure. The closure re-evaluates the whole expression in the parent's process (which is where both refs live), compares output, and notifies the p-rep only if the result changed.

## Why this model, not the alternatives

### Wrong model: p-rep subscribes directly to refs

The first attempt had the p-rep subscribing to `@content` directly, holding the closure as a function, and re-evaluating it itself.

Problems:
- **Breaks encapsulation.** The p-rep has to know which refs the closure depends on. The closure's internals leak to the consumer.
- **Wrong evaluation context.** The closure's lexical scope is in the parent actor's process. Re-evaluating it in the p-rep's process is either impossible (cross-process) or incorrect (wrong scope).
- **Can't cross boundaries.** If the p-rep is in a different process or language, it can't call a function that lives in the parent's address space.

### Right model: p-rep subscribes to the closure's address

The p-rep knows nothing about what's behind the address. It just subscribes and receives values. The closure handles its own re-evaluation, in its own process, with access to its own lexical scope.

## Key properties

**Uniform interface.** A closure has the same subscribe/notify interface as a cell. Anything that can consume a cell can consume a closure. The p-rep can't tell the difference and doesn't need to.

**Re-evaluation stays in the right process.** The closure runs in the parent actor's process, where its captured refs live. The p-rep could be in a completely different process (or language) and the model still works — it just receives values via messages.

**Crosses process and language boundaries.** Because the interface is addresses and messages (subscribe, notify-with-value), this works across the CAM actor tree. A Rust actor can produce closures; a JS p-rep can subscribe to their addresses. The closure evaluates in Rust; the p-rep receives values via plain messages. No special bridging.

**Memoization is structural.** The closure compares old and new output before notifying. If a dependency changes but the computed result is the same, silence. This isn't an optimization — it's how the mechanism works. The closure is the natural place for the comparison because it just computed both values.

**Composability.** Closures can subscribe to other closures. Reactive computations chain without the consumer knowing anything about the chain:

```
@x cell → closure_a → closure_b → p-rep
```

Each link is the same pattern: subscribe, re-evaluate, notify if changed.

## What the p-rep reduces to

Five responsibilities, zero knowledge of value provenance:

1. Hold a DOM node.
2. Hold an address (the closure's).
3. Subscribe to that address.
4. Receive values.
5. Update the DOM node.

The p-rep doesn't know about refs, doesn't know about the parent actor, doesn't know whether the address points to a simple cell or a multi-dependency computed closure. It's a leaf consumer.

## What the parent actor's role is

The parent actor:
- Holds the refs (`@content *Text`, etc.)
- Creates the closures (addressable reactive entities in its own process)
- Wires local subscriptions from refs to closures
- Passes closure addresses to the template's element reps
- Never touches the DOM after construction

Reactivity is fully delegated: refs notify closures, closures notify reps, reps update DOM. The parent actor is pure state.

## Relationship to the template rendering model

From the earlier discussion (`implicit-return-is-projection-2026-04-10.md`):

- **Static elements** → plain DOM nodes, no rep, no subscription, zero overhead.
- **Dynamic elements** (content or attributes reference mutable refs) → p-rep wrapping the DOM node. The rep subscribes to closure addresses for each dynamic child/attribute.

The compiler's job at codegen time:
1. Classify each element as static or dynamic.
2. For static elements: emit plain `createElement` / text node construction.
3. For dynamic elements: emit rep construction + closure creation + subscription wiring.
4. The parent actor's service block emits the local ref→closure subscriptions.

The compiler can do this because the closure's dependencies are lexically visible — any `*`-marked ref appearing in the closure body is a dependency. No runtime dependency tracking needed.

## Cross-references

- `notes/implicit-return-is-projection-2026-04-10.md` — the `self as Element` projection model that produces the element tree
- `notes/actor-as-constructor-2026-04-10.md` — the actor-as-constructor shape where the parent holds state and projects as an element
- `notes/template-type-2026-04-10.md` — earlier template design iteration, now mostly superseded but records the path
- `__tests__/keywords/self_as.md` — the `self as` mechanism that bridges actor identity and element projection
