# Actor-as-constructor template shape (2026-04-10)

Sibling to `template-type-2026-04-10.md`. That note records the **function-returning-element** shape for templates (file actor's `self as Function` is a regular function whose body returns an element). This note records an alternative shape Chris flagged as "potentially more interesting/useful in the short run": **actor-as-constructor**, where the file's function projection is itself a constructor expression that produces an intermediate widget actor with its own state, message surface, and an `HTML.element` projection.

Both shapes are candidates. Neither is committed.

## The shape

```
factory.bv:
<> {
  self as Function = <:initial Text> {
    content *Text = initial
    set @content = |text Text| { content <- text }
    self as HTML.element = <div>{ content }</div>
  }
}
```

```
app.bv:
<"factory.bv": (factory) *>
=
el * = factory("first content")    -- *-placement is in flux
...
el.content <- "updated content"     -- send `set` to el's content field
```

## What's going on, structurally

Two layers of `self as` composed:

- **Outer (file actor)**: `self as Function = <inner constructor expression>`. The file actor declares its function-shaped projection. The "function" is a constructor expression `<:initial Text> { ... }` — calling it produces an instance of an anonymous inner actor type.
- **Inner (widget actor)**: `self as HTML.element = <div>{ content }</div>`. Each instance the constructor produces declares its own projection — as an `HTML.element`, viewable wherever an element is expected.

The inner actor also carries:
- **State**: `content *Text = initial` (a ref initialized from the constructor param).
- **A setter handler**: `set @content = |text Text| { content <- text }` — the standard `set @field` pattern, named here so external code can mutate via `<-`.

## Why this is potentially more useful

1. **State has identity.** The widget actor is a real addressable thing. `el.content <- "updated"` sends a clean `set` message to the widget actor's setter, the inner ref updates, and the element projection re-renders via subscription. In the function-returning-element shape, there's no widget-actor-distinct-from-element to message — state lives in the function's closure scope, captured by event handlers.

2. **Factory and instance are clearly different things.** factory.bv is one actor with one projection (as a constructor). Each call to that constructor produces a separate widget actor, which has its own projection (as an element). No conflation between "the factory" and "what it produces."

3. **No new mechanism needed.** Two existing primitives — `self as` and constructor expressions — composed. The implicit-return sugar from the function-returning-element note isn't even necessary here, because the factory body has an explicit `self as Function = ...` clause. Strictly less new syntax than the alternative.

4. **Reactive parent → child updates fall out naturally.** `app.bv` holds `el`, and the parent can mutate `el.content` whenever it wants. The element re-renders because the inner actor's `self as HTML.element` clause depends on its `content` ref. This is the imperative-handle pattern (React `useImperativeHandle`, Backbone views, Svelte component instances), reachable through plain message passing.

## Contrast with the function-returning-element shape

| | Function-returning-element (04-10 note) | Actor-as-constructor (this note) |
|---|---|---|
| What `factory(args)` produces | A live DOM element actor directly | A widget actor that *projects as* a DOM element |
| Where state lives | In the function body's closure scope | In the widget actor's body (real ref fields) |
| Who can mutate state | The handlers defined inside the function body that capture it | Anyone who has a reference to the widget actor and uses its setter handlers |
| Element identity | The element IS the actor | The element is a projection of a separate actor |
| New language pieces required | Implicit-return sugar over `self as Function` | Inline anonymous constructor expressions (probably; see open questions) |
| External imperative updates | Clumsier — the element has to expose the state | Native — `el.content <- "..."` |

The function-returning-element shape feels like "stateful component, state private to the component" (React class components without `ref`). The actor-as-constructor shape feels like "stateful component with an addressable handle" (React with `useImperativeHandle`, or Backbone views).

## Open questions and concerns

1. **Inline anonymous constructor expressions.** The `<:initial Text> { ... }` form being used as a value (assigned to `self as Function = ...`) may or may not currently parse. Chris: "Frankly not sure if this is currently supported. We have inline anonymous functions, so shouldn't be a huge lift to add." This is the one piece of new syntax this shape may need.

2. **`el *` placement.** The asterisk position in `el * = factory(...)` is in flux. Existing usages of `*` are at type position (`count *Integer = 0`) and constructor-param position (`<inner *>`); declaring a local-binding actor ref without a type annotation is a new context. Worth pinning down before relying on it.

3. **Asterisk ambiguity (the live concern).** Because the actor and its element projection are distinct things, the meaning of `*` on `el` is ambiguous: does it mark `el` as a messageable actor reference (the widget actor), or as an actor reference to its element projection (the div)? Both are actors; both are messageable; the asterisk doesn't disambiguate. **Chris flagged this as potentially a reason to avoid this shape for the moment.** The function-returning-element shape doesn't have this problem because the element IS the actor — there's only one thing for `*` to refer to.

   This isn't necessarily fatal — the runtime presumably resolves projections based on context (`append!` expects an `HTML.element`, so `el` is viewed through that projection; `el.content <- ...` is a direct message to the widget actor's named handler, which is part of the widget actor's surface, not the element's). But the *binding-time* ambiguity (what does the user *think* `el` is when they declare it?) is a real readability/intent question that doesn't have a clean answer here.

4. **Reactivity of the inner projection.** `self as HTML.element = <div>{ content }</div>` has to be re-evaluated when `content` changes, or it's a one-shot snapshot. Probably exactly what the existing subscription mechanism handles, but it sits more naturally on a *projection* (which is by definition viewed-from-outside and re-viewed) than on a function return value. If anything, this is an argument for the actor-as-constructor shape — it gives reactivity a more honest place to live.

## Status

Both shapes are candidates as of 2026-04-10. The actor-as-constructor shape has these advantages:
- Cleaner state-with-identity story
- Naturally addressable for parent → child mutation
- Less new mechanism (no implicit-return sugar needed)
- Reactivity has a more natural home (projection re-evaluation)

…and these costs:
- Inline anonymous constructor expressions may need to be added
- Asterisk-ambiguity question on bindings that hold a multi-projected actor
- Two layers of indirection that the function-returning-element shape doesn't have

The function-returning-element shape (04-10 note) has these advantages:
- One thing per binding — no actor-vs-projection ambiguity
- Closer to React-style stateful-component intuition for many users
- Existing constructor / `self as Function` story covers it with just the implicit-return sugar

Neither has been committed. The next decision point is whether the asterisk-ambiguity concern is structural (inherent to having two distinct addressable things) or syntactic (resolvable with better notation).

## Cross-references
- `notes/template-type-2026-04-10.md` — function-returning-element shape, with the `self as` grounding and DI-honesty sidebar
- `notes/template-type-2026-04-09.md` — superseded B1 plan (template as built-in supertype with yields-ingest)
- `__tests__/keywords/self_as.md` — the existing `self as` mechanism that both shapes build on
