# DOM as an actor subsystem (2026-04-13)

Supplements `reactive-dom-lifecycle-2026-04-13.md`. That note covered the JS-target-specific implementation of reactive bindings using direct element references, WeakRef, and MutationObserver. This note records the corrected *conceptual* framing: the DOM is a first-class actor subsystem, elements are addressable through it, and Brevity actors never hold direct references to elements — they hold addresses and talk to elements through the DOM actor.

The earlier note is still useful as "how the JS implementation of the DOM subsystem handles its own internal bookkeeping." But the conceptual model on top of it is the one described here.

## The core principle

**The DOM owns its elements. We talk to them through it.**

This is an application of Brevity's broader "everything is an addressable actor" principle to DOM elements. Just as `@content *Text` is a cell with an address rather than a local variable, and a reactive closure is an addressable entity rather than a function value, a DOM element is an addressable entity in the DOM subsystem — not a direct object reference held by Brevity actors.

Treating DOM elements as "just native JS objects we hold references to" was a leaking of platform-specific shortcuts into the conceptual model. The principled position is that the DOM is just another subsystem, and elements are accessed via addresses and messages like anything else.

## What this changes

### Actors hold addresses, not references

A Component that memoizes its `self as HTML.Element` projection holds the **address** of the root element, not a JS pointer to it. When the Component wants to query or manipulate the element, it sends a message to that address; the DOM actor routes the message to the actual element and performs the operation.

```
Component (holds root_div_address: "dom://0x7a3f")
           |
           v
     DOM actor (looks up 0x7a3f → the real <div>)
           |
           v
     Native browser DOM
```

### The stale-reference problem dissolves

In the direct-reference model, actors could hold references to elements that the DOM destroyed out from under them. That's the problem the earlier lifecycle note was solving with WeakRef + MutationObserver: detecting that a held reference had gone dead, and cleaning up.

In the address model, there's nothing to go stale. Actors hold addresses, not references. If the Component sends a message to a dead address, the DOM actor returns "gone" (or an error, or silently drops, depending on the semantics). The DOM is the authority on element existence. Brevity actors don't need to manage lifecycle themselves — they ask, and the DOM answers.

This means the lifecycle concerns in `reactive-dom-lifecycle-2026-04-13.md` are not scattered across every reactive binding. They're centralized in the DOM actor's implementation. One place owns the knowledge of "is this element alive," and it's the one place that actually knows.

### Cross-boundary interaction works uniformly

A Rust actor (or Erlang, or a remote JS worker) can call `Component()`, receive the root element's address, and send messages to it — "set class," "append child," "query text content." Those messages travel through the CAM actor tree to the DOM actor, which dispatches to the actual JS DOM operations.

The Rust actor never holds a JS reference. It holds an address that the DOM actor translates. This is the same mechanism any cross-process actor interaction uses. There is no "JS is special" clause; the DOM is a subsystem accessed through messages, same as any other.

The cross-boundary capability isn't something you add for distributed cases and leave out for local ones. It's the native shape. Local operation is the optimized case of the same mechanism.

### The reactive subscription story is unchanged but clearer

From `reactive-closures-2026-04-13.md`: a reactive closure pushes values to an address when its output changes. In the direct-reference model, that address was implicitly "a p-rep actor that wraps a DOM element." In the address model, that address **is** the DOM element's address — routed through the DOM actor to the element itself. There's no p-rep; there's just the element, addressable in the DOM subsystem, receiving update messages.

```
Closure (addressable in Component's process)
    |
  subscribes to closure → [element_address]
    |
  on change, pushes value to element_address
    |
    v
DOM actor routes to element → sets text/attribute/whatever
```

The "p-rep as conceptual intermediary" collapses when elements themselves are addressable. The p-rep was a stand-in for "some thing that can receive messages and manipulate this DOM node." If the DOM element itself can receive messages via the DOM actor, the stand-in isn't needed.

## What the old note got right vs. over-emphasized

The `reactive-dom-lifecycle-2026-04-13.md` note describes:

- Attaching update functions as Symbol-keyed properties on DOM elements
- Using a MutationObserver on `document.body` to detect element removal
- Storing cleanup lists on elements for teardown
- Avoiding stale method references through lookup indirection

**All of this remains correct as implementation technique** — specifically, as how the JS target's DOM actor implements its own internal bookkeeping. When the JS DOM actor receives a subscription message from a reactive closure, it needs to actually do something concrete: attach a callback, watch for element removal, clean up on disconnection. The techniques in the old note are the right way to do that *inside the DOM actor's JS implementation*.

**What's wrong is the layering.** The old note implies that every Brevity-side reactive binding has to deal with these lifecycle concerns directly. It shouldn't. The Brevity side sends a subscribe message to an element address; the DOM actor handles everything else internally. The MutationObserver lives inside the DOM actor, not inside every component. The Symbol-keyed update map is the DOM actor's internal data structure for tracking per-element update callbacks, not a pattern every compiler emitter has to replicate.

The corrected layering:

```
Brevity-level:     closure.subscribe(element_address)
                              |
                              v
DOM actor API:     subscribe(address, callback_or_push_target)
                              |
                              v
DOM actor internals:    (implementation details: symbol maps,
                         MutationObserver, cleanup lists, etc.)
                              |
                              v
Native DOM:             createElement, appendChild, etc.
```

The old note was describing the bottom two layers as if they were the top layer. This note reframes the top layer as "just send messages to addresses; the DOM actor handles the rest."

## Open question: granularity of the DOM actor

Is "the DOM actor" one actor that handles all elements in a document, or is each element its own actor addressed through a DOM namespace?

- **One DOM actor**: closer to how the platform works. The DOM is a single tree; operations on it are method calls on a global. Internally, the DOM actor dispatches incoming messages to the right element based on address.
- **Per-element actors**: more "pure" (everything is an actor, elements included). Each element has an independent identity and message-handling surface. The DOM actor becomes a registry rather than a dispatcher.

Probable answer: conceptually one DOM actor that routes messages internally based on address. Each element has a unique address within the DOM's namespace and is individually messageable through the DOM's routing, but it's not a separate actor in the scheduling/process sense. That keeps the cost low (no per-element actor overhead) while preserving the addressability model.

Worth pinning down before the DOM actor is actually implemented.

## Implications for existing notes

- **`reactive-closures-2026-04-13.md`**: still correct. Closures push values to addresses. The note mentions "p-rep" as the subscriber; in the DOM-as-actor-subsystem model, the "p-rep" collapses into "a DOM element address," and the DOM actor handles the message routing and DOM update. The reactive closure side of things doesn't change.
- **`reactive-dom-lifecycle-2026-04-13.md`**: still correct as implementation technique for the DOM actor's internals, but wrong in layering. Should be read as "how the JS implementation of the DOM actor handles its own bookkeeping," not "what every reactive binding has to deal with."
- **`implicit-return-is-projection-2026-04-10.md`**: unchanged. The `self as Element` projection returns an element — which, in the corrected model, means it returns an address into the DOM subsystem, not a native JS reference. Memoization still works the same way (hold the address, return it on repeat calls).
- **`actor-as-constructor-2026-04-10.md`**: unchanged in shape. The "widget actor with DOM element projection" story still holds; the projection is just understood to return an address rather than a reference.

## Cross-references

- `notes/reactive-dom-lifecycle-2026-04-13.md` — implementation techniques (now reframed as DOM actor internals)
- `notes/reactive-closures-2026-04-13.md` — the reactive closure model that this note extends
- `notes/implicit-return-is-projection-2026-04-10.md` — the `self as Element` projection this builds on
- `notes/actor-as-constructor-2026-04-10.md` — the actor-as-constructor shape for templates
