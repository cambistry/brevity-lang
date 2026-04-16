# Implicit-return creates a projection, not an identity replacement (2026-04-10)

> **Superseded 2026-04-14 by `self-becomes-2026-04-14.md`.** This note's framing — "tail-return is `self as` sugar, implicit-return is a projection" — turned out to be wrong. The tail-return is a *different mechanism* from `self as`: it declares structural interface extension, and the wrapping actor inherits the returned-as type's interface. Both mechanisms coexist. Keep this note for the record of the path that led there, but start from `self-becomes-2026-04-14.md` for the current model.

A short clarifying note. Resolves a confusion that ran through the function-returning-element shape (`template-type-2026-04-10.md`) and the actor-as-constructor shape (`actor-as-constructor-2026-04-10.md`).

## The headline

When a constructor's service block ends with `-> expr`, the resulting actor **projects as** `expr`'s type via an implicit `self as` clause. It does **not** become `expr`. The actor identity is preserved; the return value is one face of it.

## The misconception

Both prior notes lapsed into framing implicit-return as "the constructor returns a function/element/whatever, and the constructed value IS that thing." That mental model has two follow-on problems:

- **Asterisk ambiguity**: if `widget` IS the element, but the wrapper still has handlers, what does `*` on a binding refer to? Two competing identities for one binding.
- **"How do I message the wrapper?"**: if `widget` IS the element, and the wrapper has gone away, where do `@update` and other handlers live? Nowhere reachable.

Both problems dissolve once you re-read the implicit-return rule as sugar over `self as`, which is what it actually is.

## The correction, grounded in the existing `self as` doc

The `self as` doc (`__tests__/keywords/self_as.md`) is explicit:

> An actor does not stop being an actor because it has `self as` clauses.

And the existing usage example:

```
n Integer = One()      -- n is an Integer (the projection)
Dual().greet()         -- this calls @greet on the actor itself
```

`n Integer = One()` narrows the binding to the projected value via the type annotation. After that line, `n` is just an integer — the actor is gone from `n`'s perspective. But `Dual().greet()` works because the actor expression `Dual()` hasn't been narrowed by a binding yet; you're calling a handler on the live actor.

The same rule applies to implicit-return:

```
custom = <:content Text> {
  content *Text = :content
  @update = |text Text| { content <- text }
  -> <p class="custom">{ content }</p>
}
```

This is sugar for:

```
custom = <:content Text> {
  content *Text = :content
  @update = |text Text| { content <- text }
  self as Element = <p class="custom">{ content }</p>
}
```

`custom` instances are actors with two surfaces: a named `@update` handler and an `Element` projection. Whether you reach the actor or the projection depends on what the *use site* asks for, not what the constructor does.

## The practical implication

**Don't narrow at the binding site if you want to preserve the actor.** This:

```
widget *Element = <custom content="inner" />
```

…asks the language to view widget through the Element projection, which collapses widget to the rendered `<p>` and discards the wrapper. After that line, `widget.update(...)` doesn't make sense because `widget` is just an element.

This:

```
widget = <custom content="inner" />
```

…holds the actor. Then:

- `widget.update("new content")` — direct message to the named handler, works because `widget` still holds the actor.
- `parent.append!(widget)` — context demands an Element, so the runtime applies the `self as Element` projection on the way in.

Both work simultaneously. No competition between the two identities, because there is only one identity (the actor) and the projection is a contextual view, not a separate thing.

## What the type annotation is for, then

Type annotation at a binding site is a **contextual narrowing** operation, more like a coercion than a type ascription. `widget *Element = ...` says "narrow this to its Element projection at bind time." That's a legitimate operation when you actually want it (e.g., you're done with the wrapper and want to hand the projection to something else), but it's the wrong tool when you want to keep messaging the actor.

If you want to be explicit about the actor type without narrowing, annotate with the actor type (`widget *Custom = ...`) or omit the annotation and let inference handle it.

## Concise template syntax that falls out

```
custom = <:content Text> {
  content *Text = :content
  @update = |text Text| { content <- text }
  -> <p class="custom">{ content }</p>
}

widget = <custom content="inner" />
parent.append!(widget)              -- projection used contextually
widget.update("new content")        -- handler messaged directly
```

Five lines for the constructor, three at the use site, no ambiguity. The wrapper is reachable because the binding wasn't narrowed.

## What this resolves

- **The asterisk-ambiguity concern in `actor-as-constructor-2026-04-10.md` was wrong.** It's not that `*` is ambiguous between "actor" and "projection"; it's that I was confusing narrowing-at-binding with the actor's intrinsic identity. The actor is one thing; the projection is contextual; `*` marks the binding as messageable, full stop.
- **The "either function or actor" framing in `template-type-2026-04-10.md` was already known to be wrong** (the `self as` doc resolved it earlier in the thread), but this note nails the *mechanism*: implicit-return is `self as` sugar, and `self as` projections coexist with named handlers by design.
- **The function-returning-element vs. actor-as-constructor "two shapes" framing collapses.** They're the same shape under different examples — both are constructors with state, named handlers, and a `self as Element` projection (sometimes declared explicitly, sometimes via implicit-return sugar). The "function-returning-element" shape just hides the projection inside a closure; the "actor-as-constructor" shape pulls the state and handlers into the wrapping actor's body. The choice is about *where state lives*, not about a different language mechanism.

## Status

This is the most settled the templating direction has been across the thread. No new language mechanism is required beyond:

1. The implicit-return-as-`self as` sugar rule (one parser/desugaring change).
2. Field-level setters (`set @field = ...`) — already discussed as a new use of an existing keyword.
3. Possibly inline anonymous constructor expressions, depending on which composition pattern feels best in practice.

The two prior 04-10 notes are still valid as records of the path that led here, but this note's framing should be the starting point going forward.
