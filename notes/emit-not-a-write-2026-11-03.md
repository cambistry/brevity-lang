# `emit` isn't a write — 2026-11-03

Status: **decided 2026-11-03.** Reverses "`emit` counts as a write" in
[mutation-suffix](mutation-suffix-2026-10-31.md) (Settled decisions). Partly implemented:
see "Status" below.

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

## Status

- **Implemented** on the effect-rules ticket
  ([session-2026-11-03-effect-rules](session-2026-11-03-effect-rules.md)): for the
  fresh-actor exemption, an emit doesn't reach past the actor. `w = W(); w.fire!()` where
  `fire!` only emits is no write for the caller.
- **Not yet:** an emit still counts as a write when naming the function that emits, and in
  a constructor block. That's the follow-up ticket.
