# `emit` isn't a write — 2026-11-03

Status: **decided and implemented 2026-11-03.** Reverses "`emit` counts as a write" in
[mutation-suffix](mutation-suffix-2026-10-31.md) (Settled decisions).

## Decision

An `emit` sets nothing, so it isn't a write. A function that only emits takes no `!`.

```brevity
Firer = *{
  emit fired() => .
  @fire = { fired() }        // was @fire!
}
```

## Why

- **The subscriber opted in.** It asked to hear the event, and what its handler does is its
  own business. A handler that writes is already counted as a write in its own actor, so
  counting the emit as well charges the same write twice, to the wrong actor.
- **State changes where something is set.** Writing a published cell is a write because of
  the `<-`, not the notification its subscribers get. An emit is a notification with no
  write behind it.
- **It matches `.subscribe`,** already settled as not a write. An emit is the push side of
  the same relationship.
- **Unlike a silent call.** A silent call still counts, so that a read-only function can't
  hide `account.debit.(10)...`: there the caller picks the target and the effect. An
  emitter picks neither.

## What "no `!`" now means

A function without `!` doesn't write, and nothing it calls writes. Subscribers may still
react to its events by writing, as they chose to. Handlers subscribed to an event are
dynamic, and the compiler can't see them at the emit site, so the suffix can't speak for
them.

**Transactions:** if a transaction has to include what its events set off in subscribers,
the transaction work tracks that itself. The suffix won't show it.

Refinements may follow.

## Implementation

- **`src/effects.js`:** a call to an emit isn't a write anywhere: in naming, in a
  constructor block, or for the fresh-actor exemption. A tail call to a silent emit
  (`=> .`) gives back no value, so discarding a call to a function that ends in one isn't
  a discarded read.
- **Fallout:** a `!` function that only emits is "never writes". In
  `keywords/emit.test.js`, `@fire!` became `@trigger` (a public `@fire` would clash with
  the bare emit `fire()`), `@send!` and `@validate!` lost their `!`, and so did handlers
  whose only writes went through them.

## Open

- **An emit declaration's arrow.** `emit fired() => .` still says `=>`. Decide whether it
  becomes `->`, or stays as "subscribers may act".
