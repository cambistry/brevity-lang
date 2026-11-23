# Which functions are subscribable — 2026-11-23

**Proposal**, from discussion. Layer A (`layer-a-closure-as-child-2026-04-22.md`) treats a
closure bound with `f = { expr }` as reactive: it re-runs when a cell it captures changes,
and replays to its subscribers. A function whose body makes state can't be re-run safely,
so whether a function is subscribable has to be a rule, decided by its body, not by how it
was bound. Paired with `escaping-frames-2026-11-23.md`.

## The rule

A function is subscribable when:

1. **It reads at least one subscribable address outside itself:** a cell, explicitly or
   through a closure, or a call to a function that is itself subscribable (transitively).
   A call to a non-subscribable function is a one-shot read: it doesn't make the caller
   replay.
2. **It makes no writes.** Re-running a `<-` repeats it. The service doc already carries
   `writes` per op (`opre-type-encoding-2026-11-21.md`), and the effects check reads it.
3. **No actor it makes escapes**, by any route:
   - **return:** it's in the result;
   - **write:** it's stored, with `<-`, in a cell or field outside the function (already
     ruled out by 2);
   - **send:** its address is an argument of an outgoing call (`registry.add(x)`,
     `body.attach!(el)`). Even a pure read lets the callee hold the address. Until a type
     can say a callee doesn't keep an argument, any outgoing message carrying a fresh
     actor's address counts.

   **Subscriptions don't count as escape.** A closure inside the function that subscribes to
   an outside cell gives that cell its address, but the subscription is torn down when the
   frame is released (`escaping-frames-2026-11-23.md`). Otherwise nothing reactive could be
   nested.

Subscribability is part of a function's type, and is published in the service doc beside
`writes`.

## Why condition 1 matters

```brevity
Clicker = {
  count *Integer = 0
  <div onclick={ count <- count + 1 }>{ count }</div>
}
```

`Clicker` reads nothing outside itself. Subscribed to, it would reply once and never
replay, so `count` is never remade. Harm needs both an outside read and an actor that
escapes:

```brevity
limit *Integer = 10
Clicker = {
  count *Integer = limit
  <div onclick={ count <- count + 1 }>{ count }</div>
}
```

Re-run on a change to `limit`, this makes a new `<div>` and resets `count`.

## Open: a fresh actor in the result

Conditional template holes are the hard case:

```brevity
<section>{ if show { Clicker() } else { <p>off</p> } }</section>
```

The hole reads `show` and returns a fresh actor. Re-running it is exactly what's wanted:
when `show` flips, swap the child, and a clicker turned off and on again starts over.

- **(a) Forbid.** A function whose result holds an actor it made is never subscribable.
  Conditional and repeated children need a construct of their own in templates.
- **(b) Replace on replay.** A replay that carries a fresh actor hands it to the
  subscriber, which releases the one from the previous replay, and with it that run's frame
  and subscriptions. "By return" then leaves the list of escapes in condition 3. The
  `limit` version of `Clicker` becomes legal too, and resets when `limit` changes. This is
  the Solid/React model, and it uses the release rule frames need anyway.

Leaning (b): without it, every conditional or list hole is a special case.

## Future direction

Element extension (`HTML::div ^ { … }`, see `element-extension-2026-11-23.md`)
would put published names on the element itself. A function returning such an element is a
fresh actor in the result, so it falls under (a)/(b) like any other.
