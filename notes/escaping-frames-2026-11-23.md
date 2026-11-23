# Frames that outlive their call — 2026-11-23

**Proposal**, from discussion. Follows from `constructor-return-as-retired-2026-11-23.md`:
the usual way to make a live element is a function that returns it, not a constructor that
wraps it. Rests on `cells-as-actors-ordering-2026-11-11.md` (a cell is an actor) and
`layer-a-closure-as-child-2026-04-22.md` (a closure is an addressable child). Paired with
`subscribability-2026-11-23.md`, whose replace-on-replay option relies on the release rule
here.

## The shape

```brevity
Clicker = {
  count *Integer = 0
  <div onclick={ count <- count + 1 }>{ count }</div>
}

Doubler = {
  count *Integer = 0
  double = { count * 2 }
  <div>{ double }</div>
}
```

No actor is made for the call. What gets an address is `count` (a cell, so an actor) and
each closure (`double`, the `onclick` handler, the `{ count }` hole). The `<div>` subscribes
to the closures, and they to `count`. After the function returns, the `<div>` still holds
those addresses: the call's frame is gone, but this part of it is still live.

## What it needs

1. **An address per call.** Layer A gives closures addresses by source position, per actor
   (`@0`, `@1`). A function called twice makes two `count`s and two `double`s, so each call
   needs a fresh frame address, with the cells and closures under it (shape not decided:
   e.g. a numbered frame label, `count` and `@0` inside it).
2. **A host.** The frame is a child of the actor that declares the function: here, the file
   actor. A closure's `self` is still that actor (a lambda is a closure capturing
   `self`, not a separate kind of function), and the frame is more children under it. There is no
   hidden wrapper actor, and nothing outside can talk to the frame as a whole.
3. **A lifetime.** A frame is released when nothing holds an address in it. In practice that
   means its last subscriber leaving: the `<div>` going away drops its subscriptions to the
   closures, and with no subscribers left, the frame is released. Releasing a frame tears
   down the subscriptions its own closures hold to cells outside it.

## Open

- The frame's wire address, and how a parent translates it (CAM address translation).
- Whether "holds an address" can be tracked from subscriptions alone, or whether a frame
  address passed in a plain message (not a subscription) pins the frame. If it does, the
  frame can't be released safely without some reference count across actors.
- A frame with no closure that escaped needs nothing here: it's released when the call
  returns, as today.
